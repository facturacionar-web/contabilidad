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
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

type SyncOptions = {
  ptosVenta?: number[];     // si no se pasa, se autodescubre
  cbteTipos?: number[];     // si no se pasa, usa TIPOS_DEFAULT
  maxPorPunto?: number;     // límite de comprobantes a traer por (PtoVta, TipoCbte) en cada corrida
};

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
      .filter((p) => p.Bloqueado !== "S" && !p.FchBaja)
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
