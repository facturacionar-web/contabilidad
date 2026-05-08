import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken, listAuthorizedSellers } from "./oauth";
import { searchOrders, type MlOrder } from "./orders";

export type SyncResult = {
  ordenesNuevas: number;
  porSeller: Record<string, number>;
  errores: string[];
};

type SyncOptions = {
  desdeOverride?: string;   // ISO datetime — si se pasa, ignora el checkpoint
  maxPorTanda?: number;     // tope total de órdenes a procesar por corrida (default 1000)
};

/** Convierte fecha ISO con TZ a un Date sano. */
function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Sincroniza órdenes nuevas desde ML. Para cada seller autorizado:
 *   1. Lee el checkpoint (última fecha sincronizada) o usa desdeOverride.
 *   2. Lista órdenes paginando con sort=date_asc.
 *   3. Hace upsert en ml_ordenes.
 *   4. Avanza el checkpoint a la fecha de la última orden procesada.
 */
export async function syncOrdenesMl(
  supabase: SupabaseClient,
  userId: string,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const sellers = await listAuthorizedSellers(supabase, userId);
  if (sellers.length === 0) {
    return { ordenesNuevas: 0, porSeller: {}, errores: ["no hay sellers autorizados — completar /api/ml/oauth/start"] };
  }

  const result: SyncResult = { ordenesNuevas: 0, porSeller: {}, errores: [] };
  const maxPorTanda = options.maxPorTanda ?? 1000;
  const limit = 50; // max por la API

  for (const sellerId of sellers) {
    try {
      const accessToken = await getAccessToken(supabase, userId, sellerId);

      // Determinar desde qué fecha leer
      const FALLBACK_DESDE = "2026-01-01T00:00:00Z";
      let desde: string = options.desdeOverride ?? FALLBACK_DESDE;
      let checkpointInicial: string | undefined;
      if (!options.desdeOverride) {
        const { data: cp } = await supabase
          .from("ml_sync_checkpoint")
          .select("ultima_fecha_sincronizada")
          .eq("user_id", userId)
          .eq("ml_seller_id", sellerId)
          .maybeSingle();
        const cpVal = (cp?.ultima_fecha_sincronizada as string | null | undefined) ?? FALLBACK_DESDE;
        checkpointInicial = cpVal;
        desde = cpVal;
      }

      let nuevasEsteSeller = 0;
      let ultimaFechaProcesada = desde;  // cursor por date_created (limitación ML)
      let offset = 0;

      while (nuevasEsteSeller < maxPorTanda) {
        const resp = await searchOrders({
          accessToken,
          sellerId,
          desde,
          limit,
          offset,
        });
        if (!resp.results.length) break;

        for (const order of resp.results) {
          const createdAt = parseDate(order.date_created);
          if (!createdAt) continue;

          // Saltar si ya estamos al día (la API es inclusive del `from`)
          if (checkpointInicial && createdAt <= new Date(checkpointInicial)) continue;

          // Guardamos TODAS las órdenes (incluso sin date_closed) porque la vista
          // ya filtra por date_closed not null para los reportes.
          const row = mapOrderToRow(userId, sellerId, order);
          const { error } = await supabase
            .from("ml_ordenes")
            .upsert(row, { onConflict: "user_id,ml_order_id" });

          if (error) {
            result.errores.push(`seller ${sellerId} orden ${order.id}: ${error.message}`);
            continue;
          }
          nuevasEsteSeller += 1;
          ultimaFechaProcesada = order.date_created;
          if (nuevasEsteSeller >= maxPorTanda) break;
        }

        if (resp.results.length < limit) break;
        offset += limit;
        if (offset >= 1000) {
          // Alcanzamos el límite de offset. Avanzar cursor por date_created.
          desde = ultimaFechaProcesada;
          offset = 0;
        }
      }

      if (ultimaFechaProcesada !== checkpointInicial) {
        await supabase.from("ml_sync_checkpoint").upsert({
          user_id: userId,
          ml_seller_id: sellerId,
          ultima_fecha_sincronizada: ultimaFechaProcesada,
          updated_at: new Date().toISOString(),
        });
      }

      if (nuevasEsteSeller > 0) {
        result.porSeller[String(sellerId)] = nuevasEsteSeller;
        result.ordenesNuevas += nuevasEsteSeller;
      }
    } catch (err) {
      result.errores.push(`seller ${sellerId}: ${String(err)}`);
    }
  }

  return result;
}

function mapOrderToRow(userId: string, sellerId: number, o: MlOrder): Record<string, unknown> {
  return {
    user_id: userId,
    ml_order_id: o.id,
    ml_seller_id: sellerId,
    date_created: o.date_created,
    date_closed: o.date_closed ?? null,
    status: o.status ?? null,
    total_amount: Number(o.total_amount ?? 0),
    paid_amount: o.paid_amount != null ? Number(o.paid_amount) : null,
    currency_id: o.currency_id ?? null,
    shipping_cost: o.shipping?.cost != null ? Number(o.shipping.cost) : null,
    buyer_id: o.buyer?.id ?? null,
    buyer_nickname: o.buyer?.nickname ?? null,
    pack_id: o.pack_id ?? null,
    items: (o.order_items ?? []) as unknown as object,
    raw: o as unknown as object,
    synced_at: new Date().toISOString(),
  };
}
