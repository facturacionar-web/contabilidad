import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateToPortal } from "./auth";
import { getResumenVentas, getDetalleVenta, normalizeItem, normalizeDetalle } from "./rcv";
import { getCredentials, splitRut } from "./config";

export type SyncOptions = {
  /** Cantidad de meses hacia atrás a sincronizar (default: 12). */
  meses?: number;
  /** Periodo específico YYYYMM. Si se pasa, se ignora `meses` y solo se trae ese. */
  periodo?: string;
};

export type SyncResult = {
  periodosSincronizados: number;
  filasActualizadas: number;
  detallePorPeriodo: Record<string, { items: number; totalDocs: number }>;
  errores: string[];
};

/** Genera la lista de periodos YYYYMM de los últimos N meses (incluyendo el actual). */
function ultimosPeriodos(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    out.push(`${yyyy}${mm}`);
  }
  return out;
}

/**
 * Sincroniza el resumen mensual de ventas desde el SII para los últimos N meses.
 * Sobrescribe cada (mes, tipo de DTE) con los datos vigentes en el SII.
 */
export async function syncResumenEmitidos(
  supabase: SupabaseClient,
  userId: string,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const { rut } = getCredentials();
  const { num: rutNum, dv } = splitRut(rut);
  const periodos = options.periodo ? [options.periodo] : ultimosPeriodos(options.meses ?? 12);

  const result: SyncResult = {
    periodosSincronizados: 0,
    filasActualizadas: 0,
    detallePorPeriodo: {},
    errores: [],
  };

  const client = await authenticateToPortal();
  try {
    for (const periodo of periodos) {
      try {
        const resp = await getResumenVentas(client, rut, periodo);

        if (resp.respEstado.codRespuesta !== 0) {
          result.errores.push(
            `Periodo ${periodo}: cod=${resp.respEstado.codRespuesta} ${resp.respEstado.msgeRespuesta ?? ""}`,
          );
          continue;
        }

        const items = resp.data ?? [];
        if (items.length === 0) {
          // Sin movimientos en el mes: borrar lo previo para no dejar datos viejos.
          await supabase
            .from("sii_resumen_mensual")
            .delete()
            .eq("user_id", userId)
            .eq("rut_emisor", rutNum)
            .eq("periodo", periodo);

          result.periodosSincronizados += 1;
          result.detallePorPeriodo[periodo] = { items: 0, totalDocs: 0 };
          continue;
        }

        const rows = items.map((item) => {
          const norm = normalizeItem(item, item.rsmnTipoDocInteger);
          return {
            user_id: userId,
            rut_emisor: rutNum,
            dv_emisor: dv,
            periodo,
            cod_tipo_doc: norm.cod_tipo_doc,
            nombre_tipo_doc: norm.nombre_tipo_doc,
            cantidad: norm.cantidad,
            monto_exento: norm.monto_exento,
            monto_neto: norm.monto_neto,
            monto_iva: norm.monto_iva,
            monto_total: norm.monto_total,
            raw: item as unknown as object,
            synced_at: new Date().toISOString(),
          };
        });

        const { error } = await supabase
          .from("sii_resumen_mensual")
          .upsert(rows, { onConflict: "user_id,rut_emisor,periodo,cod_tipo_doc" });

        if (error) {
          result.errores.push(`Periodo ${periodo}: upsert falló: ${error.message}`);
          continue;
        }

        result.periodosSincronizados += 1;
        result.filasActualizadas += rows.length;
        result.detallePorPeriodo[periodo] = {
          items: rows.length,
          totalDocs: items.reduce((a, b) => a + (b.rsmnTotDoc ?? 0), 0),
        };
      } catch (err) {
        result.errores.push(`Periodo ${periodo}: ${String(err)}`);
      }
    }
  } finally {
    await client.dispatcher.close().catch(() => {});
  }

  return result;
}

// ============================================================
// DETALLE: factura por factura
// ============================================================

export type SyncDetalleOptions = {
  /** Periodos a sincronizar (YYYYMM). Si se pasa, sobreescribe `desde`. */
  periodos?: string[];
  /** Periodo desde (YYYYMM inclusive) hasta el mes actual. */
  desde?: string;
};

export type SyncDetalleResult = {
  periodosSincronizados: number;
  comprobantesUpsert: number;
  porTipo: Record<string, number>;
  errores: string[];
};

function periodosDesde(desdeYYYYMM: string): string[] {
  const desdeY = Number(desdeYYYYMM.slice(0, 4));
  const desdeM = Number(desdeYYYYMM.slice(4, 6));
  const out: string[] = [];
  const now = new Date();
  const nowY = now.getFullYear();
  const nowM = now.getMonth() + 1;
  let y = desdeY;
  let m = desdeM;
  while (y < nowY || (y === nowY && m <= nowM)) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Sincroniza el detalle (factura por factura) de ventas desde el SII.
 * Por cada periodo, llama getResumen primero para saber qué tipos hay,
 * y luego getDetalleVenta por cada tipo para traer todos los DTEs.
 */
export async function syncDetalleEmitidos(
  supabase: SupabaseClient,
  userId: string,
  options: SyncDetalleOptions = {},
): Promise<SyncDetalleResult> {
  const { rut } = getCredentials();
  const { num: rutNum, dv } = splitRut(rut);
  const periodos = options.periodos ?? periodosDesde(options.desde ?? "202601");

  const result: SyncDetalleResult = {
    periodosSincronizados: 0,
    comprobantesUpsert: 0,
    porTipo: {},
    errores: [],
  };

  const client = await authenticateToPortal();
  try {
    for (const periodo of periodos) {
      try {
        // 1. Resumen para saber qué tipos de DTE hay en el periodo
        const resumen = await getResumenVentas(client, rut, periodo);
        if (resumen.respEstado.codRespuesta !== 0) {
          result.errores.push(`${periodo}: resumen cod=${resumen.respEstado.codRespuesta}`);
          continue;
        }
        // Las boletas (39, 41) requieren consulta DIFERIDA en el SII (cod=99).
        // Por volumen, el SII no expone su detalle directamente. Solo quedan en sii_resumen_mensual.
        const TIPOS_SIN_DETALLE = new Set([39, 41]);
        const tiposEnElMes = (resumen.data ?? [])
          .map((r) => r.rsmnTipoDocInteger)
          .filter((n): n is number => typeof n === "number" && !TIPOS_SIN_DETALLE.has(n));

        if (tiposEnElMes.length === 0) {
          result.periodosSincronizados += 1;
          continue;
        }

        // 2. Para cada tipo, traer detalle y upsert
        for (const codTipoDoc of tiposEnElMes) {
          try {
            const detalle = await getDetalleVenta(client, rut, periodo, codTipoDoc);
            if (detalle.respEstado.codRespuesta !== 0) {
              result.errores.push(
                `${periodo}/${codTipoDoc}: detalle cod=${detalle.respEstado.codRespuesta} ${detalle.respEstado.msgeRespuesta ?? ""}`,
              );
              continue;
            }
            const items = detalle.data ?? [];
            if (items.length === 0) continue;

            const rows = items.map((item) => {
              const norm = normalizeDetalle(item);
              return {
                user_id: userId,
                rut_emisor: rutNum,
                dv_emisor: dv,
                periodo,
                cod_tipo_doc: norm.cod_tipo_doc,
                folio: norm.folio,
                fecha_doc: norm.fecha_doc,
                rut_receptor: norm.rut_receptor,
                dv_receptor: norm.dv_receptor,
                razon_social_receptor: norm.razon_social_receptor,
                monto_exento: norm.monto_exento,
                monto_neto: norm.monto_neto,
                monto_iva: norm.monto_iva,
                monto_total: norm.monto_total,
                tasa_imp: norm.tasa_imp,
                anulado: norm.anulado,
                estado_contab: norm.estado_contab,
                desc_tipo_transaccion: norm.desc_tipo_transaccion,
                raw: item as unknown as object,
                synced_at: new Date().toISOString(),
              };
            });

            // Upsert en chunks para evitar payloads enormes
            const CHUNK = 500;
            for (let i = 0; i < rows.length; i += CHUNK) {
              const slice = rows.slice(i, i + CHUNK);
              const { error } = await supabase
                .from("sii_comprobantes_emitidos")
                .upsert(slice, { onConflict: "user_id,rut_emisor,cod_tipo_doc,folio" });
              if (error) {
                result.errores.push(`${periodo}/${codTipoDoc}: upsert: ${error.message}`);
                break;
              }
              result.comprobantesUpsert += slice.length;
            }
            result.porTipo[String(codTipoDoc)] = (result.porTipo[String(codTipoDoc)] ?? 0) + items.length;
          } catch (err) {
            result.errores.push(`${periodo}/${codTipoDoc}: ${String(err)}`);
          }
        }

        result.periodosSincronizados += 1;
      } catch (err) {
        result.errores.push(`${periodo}: ${String(err)}`);
      }
    }
  } finally {
    await client.dispatcher.close().catch(() => {});
  }

  return result;
}
