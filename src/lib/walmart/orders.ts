import { buildHeaders } from "./auth";
import { WALMART_BASE_URL, WALMART_STATUSES, type WalmartStatus } from "./config";

export type WalmartCharge = {
  chargeType?: string;
  chargeName?: string;
  chargeAmount?: { currency?: string; amount?: number };
  tax?: { taxAmount?: { currency?: string; amount?: number } };
};

export type WalmartOrderLine = {
  lineNumber: string;
  item?: { sku?: string; productName?: string };
  charges?: { charge: WalmartCharge | WalmartCharge[] };
  orderLineQuantity?: { unitOfMeasurement?: string; amount?: string };
  orderLineStatuses?: {
    orderLineStatus: Array<{
      status?: string;
      statusQuantity?: { amount?: string };
      cancellationReason?: string | null;
      trackingInfo?: {
        carrierName?: { carrier?: string; otherCarrier?: string | null };
        trackingNumber?: string;
        trackingURL?: string;
        shipmentNo?: string;
        methodCode?: string;
        actualDeliveryDateTime?: number | null;
      };
    }>;
  };
  fulfillment?: { fulfillmentOption?: string; shipMethod?: string; storeId?: string; predictedShipNodeName?: string };
};

export type WalmartOrder = {
  purchaseOrderId: string;
  customerOrderId?: string;
  customerEmailId?: string;
  orderDate?: number;            // epoch ms
  shippingInfo?: { estimatedShipDate?: number };
  orderLines?: { orderLine: WalmartOrderLine | WalmartOrderLine[] };
};

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Walmart devuelve nextCursor URL-encoded → hay que decodificarlo antes de mandarlo de nuevo. */
function decodeCursor(c: string): string {
  try {
    return decodeURIComponent(c);
  } catch {
    return c;
  }
}

export type GetOrdersParams = {
  /** Si no se pasa, trae TODOS los estados (recomendado). */
  status?: WalmartStatus;
  createdStartIso: string;       // "YYYY-MM-DDTHH:MM:SSZ"
  createdEndIso: string;
  limit?: number;                // máx 200
  cursor?: string;
};

export type GetOrdersPage = {
  orders: WalmartOrder[];
  nextCursor: string | null;     // null si terminó
  totalCount: number;
};

export async function getOrdersPage(
  accessToken: string,
  params: GetOrdersParams,
): Promise<GetOrdersPage> {
  const url = new URL(`${WALMART_BASE_URL}/v3/orders`);
  if (params.status) url.searchParams.set("status", params.status);
  url.searchParams.set("createdStartDate", params.createdStartIso);
  url.searchParams.set("createdEndDate", params.createdEndIso);
  url.searchParams.set("limit", String(params.limit ?? 200));
  if (params.cursor) url.searchParams.set("cursor", params.cursor);

  const res = await fetch(url, { headers: buildHeaders(accessToken) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Walmart GET /orders HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const j = JSON.parse(text) as {
    list?: {
      elements?: { order?: WalmartOrder | WalmartOrder[] };
      meta?: { nextCursor?: string; totalCount?: number };
    };
  };
  const orders = toArray(j.list?.elements?.order);
  const rawCursor = j.list?.meta?.nextCursor;
  const totalCount = j.list?.meta?.totalCount ?? 0;
  const nextCursor = !rawCursor || rawCursor === "-1" ? null : decodeCursor(rawCursor);
  return { orders, nextCursor, totalCount };
}

/**
 * Trae TODAS las órdenes de un rango paginando con cursor.
 * No filtra por status (la API devuelve todos los estados juntos cuando se omite).
 */
export async function getAllOrders(
  accessToken: string,
  createdStartIso: string,
  createdEndIso: string,
): Promise<WalmartOrder[]> {
  const out: WalmartOrder[] = [];
  let cursor: string | undefined = undefined;
  let safety = 0;
  do {
    const page = await getOrdersPage(accessToken, {
      createdStartIso,
      createdEndIso,
      limit: 200,
      cursor,
    });
    out.push(...page.orders);
    cursor = page.nextCursor ?? undefined;
    if (++safety > 500) throw new Error("getAllOrders: superado 500 páginas — abortando");
  } while (cursor);
  return out;
}

// ============================================================
// Helpers de extracción de datos del XML/JSON crudo
// ============================================================

/** Suma todos los chargeType='PRODUCT' de todas las líneas de una orden. */
export function calcOrderTotal(order: WalmartOrder): number {
  let total = 0;
  for (const line of toArray(order.orderLines?.orderLine)) {
    for (const ch of toArray(line.charges?.charge)) {
      if (ch.chargeType === "PRODUCT") total += Number(ch.chargeAmount?.amount ?? 0);
    }
  }
  return total;
}

/** Suma de "shipping" y otros cargos no-producto (para tener visibilidad). */
export function calcOrderShipping(order: WalmartOrder): number {
  let total = 0;
  for (const line of toArray(order.orderLines?.orderLine)) {
    for (const ch of toArray(line.charges?.charge)) {
      if (ch.chargeType === "SHIPPING") total += Number(ch.chargeAmount?.amount ?? 0);
    }
  }
  return total;
}

export function lineQuantity(line: WalmartOrderLine): number {
  return Number(line.orderLineQuantity?.amount ?? 0);
}

export function lineProductAmount(line: WalmartOrderLine): number {
  for (const ch of toArray(line.charges?.charge)) {
    if (ch.chargeType === "PRODUCT") return Number(ch.chargeAmount?.amount ?? 0);
  }
  return 0;
}

/** Devuelve el "estado actual" de la línea (el más reciente, asume último del array). */
export function lineStatus(line: WalmartOrderLine): string | null {
  const arr = line.orderLineStatuses?.orderLineStatus ?? [];
  return arr[arr.length - 1]?.status ?? null;
}

/** Estado consolidado de una orden: el "peor" status entre las líneas (ej: si una está Cancelled, marcamos la orden Cancelled). */
export function consolidateOrderStatus(order: WalmartOrder): string | null {
  const lines = toArray(order.orderLines?.orderLine);
  const statuses = lines.map(lineStatus).filter((s): s is string => !!s);
  if (statuses.length === 0) return null;
  const priority = ["Cancelled", "Refunded", "Delivered", "Shipped", "Acknowledged", "Created"];
  for (const p of priority) {
    if (statuses.includes(p)) return p;
  }
  return statuses[0];
}

export function extractEnviameDeliveryId(trackingURL: string | undefined | null): string | null {
  if (!trackingURL) return null;
  const m = trackingURL.match(/\/deliveries\/(\d+)\//);
  return m ? m[1] : null;
}

export function lineTracking(line: WalmartOrderLine) {
  const last = (line.orderLineStatuses?.orderLineStatus ?? []).at(-1);
  const t = last?.trackingInfo;
  return {
    carrier: t?.carrierName?.carrier ?? t?.carrierName?.otherCarrier ?? null,
    tracking_number: t?.trackingNumber ?? null,
    tracking_url: t?.trackingURL ?? null,
    enviame_delivery_id: extractEnviameDeliveryId(t?.trackingURL),
  };
}

export function epochMsToIso(ms: number | undefined | null): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
