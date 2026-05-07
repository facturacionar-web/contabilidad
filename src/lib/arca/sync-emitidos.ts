import type { SupabaseClient } from "@supabase/supabase-js";
import { getCredentials } from "./config";
import { getAccessTicket } from "./wsaa";
import {
  feCompUltimoAutorizado,
  feCompConsultar,
  feParamGetPtosVenta,
  type Comprobante,
} from "./wsfev1";

// Tipos de comprobante "habituales" — se puede sobreescribir vía opciones.
// Lista completa: FEParamGetTiposCbte. Acá los más comunes para emisión.
const TIPOS_DEFAULT = [1, 2, 3, 6, 7, 8, 11, 12, 13, 19, 20, 21, 51, 52, 53, 81, 82, 83];

function parseAfipDate(v?: string | null): string | null {
  if (!v) return null;
  const s = String(v);
  if (s === "NULL" || s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

// fast-xml-parser convierte campos xsi:nil="true" en string "NULL".
const isNil = (v: unknown): boolean =>
  v == null || v === "" || v === "NULL";

type SyncOptions = {
  ptosVenta?: number[];     // si no se pasa, se autodescubre
  cbteTipos?: number[];     // si no se pasa, usa TIPOS_DEFAULT
  maxPorPunto?: number;     // límite de comprobantes a traer por (PtoVta, TipoCbte) en cada corrida
};

/**
 * Compara fechas formato YYYYMMDD (string) lexicográficamente — funciona
 * porque YYYY-padded MM y DD ordenan igual que numéricamente.
 */
function fchGte(a?: string | null, b?: string | null): boolean {
  if (!a || a === "NULL") return false;
  if (!b || b === "NULL") return true;
  return String(a) >= String(b);
}

/**
 * Binary search: busca el primer cbte_nro con CbteFch >= fechaDesde.
 * Devuelve null si no hay ningún comprobante posterior a la fecha.
 * Hace ~log2(ultimoAfip) llamadas a FECompConsultar.
 */
async function findFirstCbteNroSinceDate(
  ticket: { token: string; sign: string; expiraAt: Date },
  cuit: string,
  ptoVta: number,
  cbteTipo: number,
  fechaDesdeYYYYMMDD: string,
  ultimoAfip: number,
): Promise<number | null> {
  if (ultimoAfip <= 0) return null;

  // Si el último ya es anterior a la fecha → no hay nada relevante
  const ultimo = await feCompConsultar(ticket, cuit, ptoVta, cbteTipo, ultimoAfip);
  if (!ultimo || !fchGte(ultimo.CbteFch, fechaDesdeYYYYMMDD)) return null;

  // Si el primero ya cumple → traer desde 1
  const primero = await feCompConsultar(ticket, cuit, ptoVta, cbteTipo, 1);
  if (primero && fchGte(primero.CbteFch, fechaDesdeYYYYMMDD)) return 1;

  // Binary search: invariante lo.fecha < fechaDesde, hi.fecha >= fechaDesde
  let lo = 1;
  let hi = ultimoAfip;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const c = await feCompConsultar(ticket, cuit, ptoVta, cbteTipo, mid);
    if (c && fchGte(c.CbteFch, fechaDesdeYYYYMMDD)) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

export type InitCheckpointsResult = {
  inicializadas: Array<{ ptoVta: number; cbteTipo: number; primerNuevoNro: number; ultimoAfip: number }>;
  saltadas: Array<{ ptoVta: number; cbteTipo: number; razon: string; ultimoAfip?: number }>;
  errores: string[];
};

/**
 * Inicializa checkpoints para que la próxima corrida del sync solo traiga
 * comprobantes con fecha >= fechaDesde.
 *
 * Para cada (PtoVta, Tipo):
 * - Busca el primer cbte_nro cuyo CbteFch >= fechaDesde (binary search)
 * - Setea ultimo_nro_sincronizado = (primerNuevoNro - 1)
 * - Si no hay ninguno relevante (todos viejos), setea ultimo_nro_sincronizado = ultimoAfip
 *   para que sync no haga nada y empiece a traer recién cuando se emitan nuevos
 */
export async function initCheckpointsDesdeFecha(
  supabase: SupabaseClient,
  userId: string,
  fechaDesde: string,                  // formato YYYY-MM-DD
  options: { ptosVenta?: number[]; cbteTipos?: number[] } = {}
): Promise<InitCheckpointsResult> {
  const { cuit } = getCredentials();
  const ticket = await getAccessTicket(supabase, userId, "wsfe");

  const fechaYYYYMMDD = fechaDesde.replaceAll("-", "");
  if (fechaYYYYMMDD.length !== 8 || !/^\d+$/.test(fechaYYYYMMDD)) {
    throw new Error(`fechaDesde inválida: ${fechaDesde}. Formato esperado YYYY-MM-DD.`);
  }

  let ptosVenta = options.ptosVenta;
  if (!ptosVenta) {
    const all = await feParamGetPtosVenta(ticket, cuit);
    ptosVenta = all
      .filter((p) => p.Bloqueado !== "S" && isNil(p.FchBaja))
      .map((p) => Number(p.Nro));
  }

  const cbteTipos = options.cbteTipos ?? TIPOS_DEFAULT;
  const result: InitCheckpointsResult = { inicializadas: [], saltadas: [], errores: [] };

  for (const ptoVta of ptosVenta) {
    for (const cbteTipo of cbteTipos) {
      try {
        const ultimoAfip = await feCompUltimoAutorizado(ticket, cuit, ptoVta, cbteTipo);
        if (ultimoAfip <= 0) {
          result.saltadas.push({ ptoVta, cbteTipo, razon: "no hay comprobantes emitidos", ultimoAfip });
          continue;
        }

        const primerNuevoNro = await findFirstCbteNroSinceDate(
          ticket, cuit, ptoVta, cbteTipo, fechaYYYYMMDD, ultimoAfip
        );

        if (primerNuevoNro === null) {
          // Todos los comprobantes son anteriores → checkpoint = ultimoAfip
          await supabase.from("arca_sync_checkpoint").upsert({
            user_id: userId,
            pto_vta: ptoVta,
            cbte_tipo: cbteTipo,
            ultimo_nro_sincronizado: ultimoAfip,
            updated_at: new Date().toISOString(),
          });
          result.saltadas.push({ ptoVta, cbteTipo, razon: "todos los comprobantes son anteriores a la fecha", ultimoAfip });
        } else {
          await supabase.from("arca_sync_checkpoint").upsert({
            user_id: userId,
            pto_vta: ptoVta,
            cbte_tipo: cbteTipo,
            ultimo_nro_sincronizado: primerNuevoNro - 1,
            updated_at: new Date().toISOString(),
          });
          result.inicializadas.push({ ptoVta, cbteTipo, primerNuevoNro, ultimoAfip });
        }
      } catch (err) {
        result.errores.push(`PtoVta ${ptoVta} Tipo ${cbteTipo}: ${String(err)}`);
      }
    }
  }

  return result;
}

export type SyncResult = {
  comprobantesNuevos: number;
  porTipo: Record<string, number>;
  errores: string[];
};

/**
 * Sincroniza incrementalmente los comprobantes emitidos desde ARCA.
 * Itera (PtoVta, TipoCbte) y trae desde el último checkpoint hasta el último autorizado.
 */
export async function syncComprobantesEmitidos(
  supabase: SupabaseClient,
  userId: string,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const { cuit } = getCredentials();
  const cuitNum = Number(cuit);

  const ticket = await getAccessTicket(supabase, userId, "wsfe");

  let ptosVenta = options.ptosVenta;
  if (!ptosVenta) {
    const all = await feParamGetPtosVenta(ticket, cuit);
    ptosVenta = all
      .filter((p) => p.Bloqueado !== "S" && isNil(p.FchBaja))
      .map((p) => Number(p.Nro));
  }
  if (ptosVenta.length === 0) {
    return { comprobantesNuevos: 0, porTipo: {}, errores: ["no hay puntos de venta habilitados"] };
  }

  const cbteTipos = options.cbteTipos ?? TIPOS_DEFAULT;
  const maxPorPunto = options.maxPorPunto ?? 500;

  const result: SyncResult = { comprobantesNuevos: 0, porTipo: {}, errores: [] };

  for (const ptoVta of ptosVenta) {
    for (const cbteTipo of cbteTipos) {
      try {
        const ultimoAfip = await feCompUltimoAutorizado(ticket, cuit, ptoVta, cbteTipo);
        if (ultimoAfip <= 0) continue;

        const { data: cp } = await supabase
          .from("arca_sync_checkpoint")
          .select("ultimo_nro_sincronizado")
          .eq("user_id", userId)
          .eq("pto_vta", ptoVta)
          .eq("cbte_tipo", cbteTipo)
          .maybeSingle();

        const desde = (cp?.ultimo_nro_sincronizado ?? 0) + 1;
        const hasta = Math.min(ultimoAfip, desde + maxPorPunto - 1);
        if (desde > hasta) continue;

        let ultimoOk = cp?.ultimo_nro_sincronizado ?? 0;
        let nuevosEnEsteParo = 0;

        for (let nro = desde; nro <= hasta; nro++) {
          const c: Comprobante | null = await feCompConsultar(ticket, cuit, ptoVta, cbteTipo, nro);
          if (!c) continue;

          const fechaCbte = parseAfipDate(c.CbteFch) ?? new Date().toISOString().slice(0, 10);
          const caeVto = parseAfipDate(c.FchVto);

          const row = {
            user_id: userId,
            cuit_emisor: cuitNum,
            pto_vta: ptoVta,
            cbte_tipo: cbteTipo,
            cbte_nro: nro,
            fecha_cbte: fechaCbte,
            doc_tipo: c.DocTipo ?? null,
            doc_nro: c.DocNro ?? null,
            imp_total: Number(c.ImpTotal ?? 0),
            imp_tot_conc: c.ImpTotConc != null ? Number(c.ImpTotConc) : null,
            imp_neto: c.ImpNeto != null ? Number(c.ImpNeto) : null,
            imp_op_ex: c.ImpOpEx != null ? Number(c.ImpOpEx) : null,
            imp_iva: c.ImpIVA != null ? Number(c.ImpIVA) : null,
            imp_trib: c.ImpTrib != null ? Number(c.ImpTrib) : null,
            mon_id: c.MonId ?? null,
            mon_cotiz: c.MonCotiz != null ? Number(c.MonCotiz) : null,
            cae: String(c.CodAutorizacion ?? ""),
            cae_vto: caeVto,
            resultado: c.Resultado ?? null,
            raw: c as unknown as object,
            synced_at: new Date().toISOString(),
          };

          const { error } = await supabase
            .from("arca_comprobantes_emitidos")
            .upsert(row, { onConflict: "user_id,pto_vta,cbte_tipo,cbte_nro" });

          if (error) {
            result.errores.push(`PtoVta ${ptoVta} Tipo ${cbteTipo} Nro ${nro}: ${error.message}`);
            continue;
          }

          ultimoOk = nro;
          nuevosEnEsteParo += 1;
        }

        if (ultimoOk > (cp?.ultimo_nro_sincronizado ?? 0)) {
          await supabase.from("arca_sync_checkpoint").upsert({
            user_id: userId,
            pto_vta: ptoVta,
            cbte_tipo: cbteTipo,
            ultimo_nro_sincronizado: ultimoOk,
            updated_at: new Date().toISOString(),
          });
        }

        if (nuevosEnEsteParo > 0) {
          const key = `${ptoVta}/${cbteTipo}`;
          result.porTipo[key] = nuevosEnEsteParo;
          result.comprobantesNuevos += nuevosEnEsteParo;
        }
      } catch (err) {
        result.errores.push(`PtoVta ${ptoVta} Tipo ${cbteTipo}: ${String(err)}`);
      }
    }
  }

  return result;
}
