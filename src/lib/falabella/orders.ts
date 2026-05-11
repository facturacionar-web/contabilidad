import { callApi } from "./auth";

/** Falabella devuelve siempre {a:b} para 1 item y {a:[b1,b2]} para varios. Esto los unifica. */
function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export type FalabellaOrder = {
  OrderId: string | number;
  OrderNumber?: string | number;
  CreatedAt: string;
  UpdatedAt?: string;
  NationalRegistrationNumber?: string;
  ItemsCount?: string | number;
  GrandTotal: string;
  ProductTotal?: string;
  TaxAmount?: string;
  ShippingFeeTotal?: string;
  Voucher?: string;
  Statuses?: { Status: string | string[] };
  ShippingType?: string;
  OperatorCode?: string;
  Price?: string;
  ExtraAttributes?: string;
  ExtraBillingAttributes?: Record<string, string>;
};

export type FalabellaOrderItem = {
  OrderItemId: string | number;
  OrderId: string | number;
  Name?: string;
  Sku?: string;
  ShopSku?: string;
  Variation?: string;
  Status?: string;
  Currency?: string;
  ItemPrice?: string;
  PaidPrice?: string;
  VoucherAmount?: string;
  TaxAmount?: string;
  ShippingAmount?: string;
  ShippingServiceCost?: string;
  ShippingTax?: string;
  WalletCredits?: string;
  ShipmentProvider?: string;
  TrackingCode?: string;
  PackageId?: string;
  IsDigital?: string;
  ReturnStatus?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
  SalesType?: string;
};

/**
 * Trae órdenes en un rango de fechas.
 * El SC devuelve max 100 por página (Limit). Hay que paginar con Offset.
 */
export async function getOrders(params: {
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  status?: string;
  limit?: number;
  offset?: number;
  sortDirection?: "ASC" | "DESC";
}): Promise<FalabellaOrder[]> {
  const body = await callApi<{ Orders: { Order: FalabellaOrder | FalabellaOrder[] } }>(
    "GetOrders",
    {
      CreatedAfter: params.createdAfter,
      CreatedBefore: params.createdBefore,
      UpdatedAfter: params.updatedAfter,
      UpdatedBefore: params.updatedBefore,
      Status: params.status,
      Limit: params.limit ?? 100,
      Offset: params.offset ?? 0,
      SortBy: "created_at",
      SortDirection: params.sortDirection ?? "ASC",
    },
  );
  return toArray(body.Orders?.Order);
}

/** Trae todas las órdenes paginando hasta vaciar. */
export async function getAllOrders(params: {
  createdAfter: string;
  createdBefore?: string;
  pageSize?: number;
}): Promise<FalabellaOrder[]> {
  const pageSize = params.pageSize ?? 100;
  const out: FalabellaOrder[] = [];
  let offset = 0;
  while (true) {
    const batch = await getOrders({
      createdAfter: params.createdAfter,
      createdBefore: params.createdBefore,
      limit: pageSize,
      offset,
    });
    out.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
    if (offset > 50_000) {
      throw new Error("getAllOrders: superado el límite de 50k registros — usar rangos más chicos");
    }
  }
  return out;
}

/** Items de UNA orden. */
export async function getOrderItems(orderId: string | number): Promise<FalabellaOrderItem[]> {
  const body = await callApi<{ OrderItems: { OrderItem: FalabellaOrderItem | FalabellaOrderItem[] } }>(
    "GetOrderItems",
    { OrderId: orderId },
  );
  return toArray(body.OrderItems?.OrderItem);
}

/**
 * Items de varias órdenes en una sola llamada. Hasta 1000 OrderIds por request.
 * Mucho más eficiente que iterar getOrderItems.
 */
export async function getMultipleOrderItems(orderIds: Array<string | number>): Promise<
  Map<string, FalabellaOrderItem[]>
> {
  if (orderIds.length === 0) return new Map();
  // OrderIdList es una lista separada por comas
  const body = await callApi<{
    Orders: { Order: { OrderId: string | number; OrderItems: { OrderItem: FalabellaOrderItem | FalabellaOrderItem[] } } | Array<{ OrderId: string | number; OrderItems: { OrderItem: FalabellaOrderItem | FalabellaOrderItem[] } }> };
  }>("GetMultipleOrderItems", {
    OrderIdList: orderIds.join(","),
  });

  const orders = toArray(body.Orders?.Order);
  const map = new Map<string, FalabellaOrderItem[]>();
  for (const o of orders) {
    map.set(String(o.OrderId), toArray(o.OrderItems?.OrderItem));
  }
  return map;
}

/** Helper: convierte "2026-05-11 15:10:54" o ISO en Date (asume UTC si no especifica). */
export function parseFalabellaDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  // Falabella suele devolver "YYYY-MM-DD HH:MM:SS" sin offset (UTC implícito)
  const d = new Date(s.includes("T") || s.includes("+") ? s : s.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}
