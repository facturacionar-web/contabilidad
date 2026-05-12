import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken } from "./auth";
import {
  getAllOrders,
  calcOrderTotal,
  calcOrderShipping,
  consolidateOrderStatus,
  lineQuantity,
  lineProductAmount,
  lineStatus,
  lineTracking,
  epochMsToIso,
  type WalmartOrder,
  type WalmartOrderLine,
} from "./orders";

export type SyncWalmartOptions = {
  createdStart?: string;   // ISO "YYYY-MM-DDTHH:MM:SSZ"
  createdEnd?: string;
  dias?: number;
};

export type SyncWalmartResult = {
  ordenesUpsert: number;
  linesUpsert: number;
  rango: { desde: string; hasta: string };
  errores: string[];
};

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function isoZ(d: Date): string {
  return d.toISOString().split(".")[0] + "Z";
}

export async function syncWalmartOrders(
  supabase: SupabaseClient,
  userId: string,
  options: SyncWalmartOptions = {},
): Promise<SyncWalmartResult> {
  const ahora = new Date();
  const dias = options.dias ?? 7;
  const desde = options.createdStart ?? isoZ(new Date(ahora.getTime() - dias * 24 * 3600 * 1000));
  const hasta = options.createdEnd ?? isoZ(ahora);

  const result: SyncWalmartResult = {
    ordenesUpsert: 0,
    linesUpsert: 0,
    rango: { desde, hasta },
    errores: [],
  };

  const token = await getAccessToken(supabase, userId);

  // Walmart Chile: iterar Created + Acknowledged, dedupliar por purchaseOrderId
  // (Ya lo hace getAllOrders por dentro)
  // Pero hay un límite práctico: si el rango es muy grande puede tardar mucho.
  // Por eso si dias > 60, partimos en ventanas mensuales (similar a Falabella).
  const desdeMs = new Date(desde).getTime();
  const hastaMs = new Date(hasta).getTime();
  const MES_MS = 30 * 24 * 3600 * 1000;

  const ordenes: WalmartOrder[] = [];
  let cursor = desdeMs;
  while (cursor < hastaMs) {
    const fin = Math.min(cursor + MES_MS, hastaMs);
    const isoIni = isoZ(new Date(cursor));
    const isoFin = isoZ(new Date(fin));
    try {
      const batch = await getAllOrders(token, isoIni, isoFin);
      ordenes.push(...batch);
    } catch (e) {
      result.errores.push(`ventana ${isoIni} → ${isoFin}: ${String(e)}`);
    }
    cursor = fin;
  }

  if (ordenes.length === 0) return result;

  // Build rows
  const orderRows = ordenes.map((o) => {
    const total = calcOrderTotal(o);
    const shipping = calcOrderShipping(o);
    void shipping; // no se persiste por separado por ahora
    const lines = toArray(o.orderLines?.orderLine);
    const totalQty = lines.reduce((s, l) => s + lineQuantity(l), 0);
    return {
      user_id: userId,
      purchase_order_id: o.purchaseOrderId,
      customer_order_id: o.customerOrderId ?? null,
      order_date: epochMsToIso(o.orderDate) ?? new Date().toISOString(),
      estimated_ship_date: epochMsToIso(o.shippingInfo?.estimatedShipDate),
      status: consolidateOrderStatus(o),
      total_amount: total,
      total_quantity: totalQty,
      currency: "CLP",
      raw: o as unknown as object,
      synced_at: new Date().toISOString(),
    };
  });

  // Upsert órdenes en chunks de 500
  const CHUNK = 500;
  for (let i = 0; i < orderRows.length; i += CHUNK) {
    const slice = orderRows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("walmart_orders")
      .upsert(slice, { onConflict: "user_id,purchase_order_id" });
    if (error) {
      result.errores.push(`orders upsert ${i}-${i + slice.length}: ${error.message}`);
      continue;
    }
    result.ordenesUpsert += slice.length;
  }

  // Build line rows
  const lineRows: Array<Record<string, unknown>> = [];
  for (const o of ordenes) {
    for (const line of toArray<WalmartOrderLine>(o.orderLines?.orderLine)) {
      const trk = lineTracking(line);
      lineRows.push({
        user_id: userId,
        purchase_order_id: o.purchaseOrderId,
        line_number: line.lineNumber,
        sku: line.item?.sku ?? null,
        product_name: line.item?.productName ?? null,
        quantity: lineQuantity(line),
        unit_price: lineProductAmount(line),
        line_amount: lineProductAmount(line),
        currency: "CLP",
        status: lineStatus(line),
        tracking_url: trk.tracking_url,
        enviame_delivery_id: trk.enviame_delivery_id,
        carrier: trk.carrier,
        tracking_number: trk.tracking_number,
        raw: line as unknown as object,
        synced_at: new Date().toISOString(),
      });
    }
  }

  for (let i = 0; i < lineRows.length; i += CHUNK) {
    const slice = lineRows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("walmart_order_lines")
      .upsert(slice, { onConflict: "user_id,purchase_order_id,line_number" });
    if (error) {
      result.errores.push(`lines upsert ${i}-${i + slice.length}: ${error.message}`);
      continue;
    }
    result.linesUpsert += slice.length;
  }

  return result;
}
