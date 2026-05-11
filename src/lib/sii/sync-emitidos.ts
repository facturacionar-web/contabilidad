import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateToPortal } from "./auth";
import { getResumenVentas, normalizeItem } from "./rcv";
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
