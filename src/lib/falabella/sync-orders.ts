import type { SupabaseClient } from "@supabase/supabase-js";
import { getAllOrders, getMultipleOrderItems, parseFalabellaDate, type FalabellaOrder, type FalabellaOrderItem } from "./orders";

export type SyncOrdersOptions = {
  /** ISO con offset, ej "2026-01-01T00:00:00+00:00". Si no se pasa, usa hace `dias` atrás. */
  createdAfter?: string;
  createdBefore?: string;
  dias?: number;
};

export type SyncOrdersResult = {
  ordenesUpsert: number;
  itemsUpsert: number;
  rango: { desde: string; hasta: string };
  errores: string[];
};

function num(s: string | undefined | null): number | null {
  if (s == null || s === "") return null;
  // Falabella usa "10,071.00" (coma de miles, punto decimal)
  const clean = String(s).replace(/,/g, "");
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function int(s: string | number | undefined | null): number | null {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function statusOf(o: FalabellaOrder): string | null {
  const s = o.Statuses?.Status;
  if (!s) return null;
  return Array.isArray(s) ? s.join(",") : s;
}

/**
 * Sincroniza órdenes + items de Falabella en un rango de fechas.
 * Por simplicidad usamos createdAfter (filtra por CreatedAt). Para detectar cambios
 * de estado en órdenes viejas, el cron puede traer también las últimas 24h por UpdatedAfter.
 */
export async function syncFalabellaOrders(
  supabase: SupabaseClient,
  userId: string,
  options: SyncOrdersOptions = {},
): Promise<SyncOrdersResult> {
  const ahora = new Date();
  const dias = options.dias ?? 7;
  const desdeDate = new Date(ahora.getTime() - dias * 24 * 3600 * 1000);
  const createdAfter = options.createdAfter ?? desdeDate.toISOString().replace(/\.\d+Z$/, "+00:00");
  const createdBefore = options.createdBefore;

  const result: SyncOrdersResult = {
    ordenesUpsert: 0,
    itemsUpsert: 0,
    rango: { desde: createdAfter, hasta: createdBefore ?? new Date().toISOString() },
    errores: [],
  };

  // Falabella tiene un límite duro de offset (~3000-5000). Para rangos grandes
  // hay que dividir en ventanas semanales y paginar dentro de cada ventana.
  const desdeMs = new Date(createdAfter).getTime();
  const hastaMs = createdBefore ? new Date(createdBefore).getTime() : Date.now();
  const SEMANA_MS = 7 * 24 * 3600 * 1000;

  const orders: FalabellaOrder[] = [];
  let cursor = desdeMs;
  while (cursor < hastaMs) {
    const finVentana = Math.min(cursor + SEMANA_MS, hastaMs);
    const isoDesde = new Date(cursor).toISOString().replace(/\.\d+Z$/, "+00:00");
    const isoHasta = new Date(finVentana).toISOString().replace(/\.\d+Z$/, "+00:00");
    try {
      const batch = await getAllOrders({
        createdAfter: isoDesde,
        createdBefore: isoHasta,
        pageSize: 100,
      });
      orders.push(...batch);
    } catch (e) {
      result.errores.push(`ventana ${isoDesde} -> ${isoHasta}: ${String(e)}`);
    }
    cursor = finVentana;
  }

  if (orders.length === 0) return result;

  // 2. Upsert de cabeceras
  const orderRows = orders.map((o) => {
    const createdAt = parseFalabellaDate(o.CreatedAt);
    const updatedAt = parseFalabellaDate(o.UpdatedAt);
    return {
      user_id: userId,
      order_id: int(o.OrderId)!,
      order_number: int(o.OrderNumber as string | number),
      created_at_fb: createdAt?.toISOString() ?? new Date().toISOString(),
      updated_at_fb: updatedAt?.toISOString() ?? null,
      customer_rut: o.NationalRegistrationNumber ?? null,
      items_count: int(o.ItemsCount as string | number),
      grand_total: num(o.GrandTotal) ?? 0,
      product_total: num(o.ProductTotal ?? undefined),
      tax_amount: num(o.TaxAmount ?? undefined),
      shipping_fee: num(o.ShippingFeeTotal ?? undefined),
      voucher_amount: num(o.Voucher ?? undefined),
      status: statusOf(o),
      shipping_type: o.ShippingType ?? null,
      operator_code: o.OperatorCode ?? null,
      currency: "CLP",
      raw: o as unknown as object,
      synced_at: new Date().toISOString(),
    };
  });

  // Insertar en chunks (limit Supabase de 1000)
  const CHUNK = 500;
  for (let i = 0; i < orderRows.length; i += CHUNK) {
    const slice = orderRows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("falabella_orders")
      .upsert(slice, { onConflict: "user_id,order_id" });
    if (error) {
      result.errores.push(`orders upsert ${i}-${i + slice.length}: ${error.message}`);
      continue;
    }
    result.ordenesUpsert += slice.length;
  }

  // 3. Traer items en lotes con GetMultipleOrderItems (hasta 1000 OrderIds por llamada)
  const orderIds = orders.map((o) => Number(o.OrderId));
  const ITEM_BATCH = 100; // mantenemos bajo para evitar URLs gigantes
  const allItems: Array<FalabellaOrderItem & { OrderId: number }> = [];
  for (let i = 0; i < orderIds.length; i += ITEM_BATCH) {
    const batchIds = orderIds.slice(i, i + ITEM_BATCH);
    try {
      const map = await getMultipleOrderItems(batchIds);
      for (const [oid, items] of map) {
        for (const it of items) {
          allItems.push({ ...it, OrderId: Number(oid) });
        }
      }
    } catch (e) {
      result.errores.push(`items batch ${i}-${i + batchIds.length}: ${String(e)}`);
    }
  }

  // 4. Upsert items
  const itemRows = allItems.map((it) => ({
    user_id: userId,
    order_item_id: int(it.OrderItemId)!,
    order_id: it.OrderId,
    name: it.Name ?? null,
    sku: it.Sku ?? null,
    shop_sku: it.ShopSku ?? null,
    variation: it.Variation ?? null,
    status: it.Status ?? null,
    item_price: num(it.ItemPrice ?? undefined),
    paid_price: num(it.PaidPrice ?? undefined),
    voucher_amount: num(it.VoucherAmount ?? undefined),
    tax_amount: num(it.TaxAmount ?? undefined),
    shipping_amount: num(it.ShippingAmount ?? undefined),
    shipping_service_cost: num(it.ShippingServiceCost ?? undefined),
    shipping_tax: num(it.ShippingTax ?? undefined),
    wallet_credits: num(it.WalletCredits ?? undefined),
    currency: it.Currency ?? "CLP",
    shipment_provider: it.ShipmentProvider ?? null,
    tracking_code: it.TrackingCode ?? null,
    package_id: it.PackageId ?? null,
    sales_type: it.SalesType ?? null,
    is_digital: it.IsDigital === "1",
    return_status: it.ReturnStatus ?? null,
    created_at_fb: parseFalabellaDate(it.CreatedAt)?.toISOString() ?? null,
    updated_at_fb: parseFalabellaDate(it.UpdatedAt)?.toISOString() ?? null,
    raw: it as unknown as object,
    synced_at: new Date().toISOString(),
  }));

  for (let i = 0; i < itemRows.length; i += CHUNK) {
    const slice = itemRows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("falabella_order_items")
      .upsert(slice, { onConflict: "user_id,order_item_id" });
    if (error) {
      result.errores.push(`items upsert ${i}-${i + slice.length}: ${error.message}`);
      continue;
    }
    result.itemsUpsert += slice.length;
  }

  return result;
}
