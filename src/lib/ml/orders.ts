import { ML_API_BASE } from "./config";

/** Subset de campos que nos interesan de una orden ML. */
export type MlOrder = {
  id: number;
  date_created: string;
  date_closed?: string;
  status: string;
  total_amount: number;
  paid_amount?: number;
  currency_id?: string;
  site_id?: string;        // MLA | MLC | MLM | ...
  shipping?: { id?: number; cost?: number };
  buyer?: { id?: number; nickname?: string };
  pack_id?: number | null;
  order_items?: unknown[];
};

type SearchResponse = {
  results: MlOrder[];
  paging: { total: number; offset: number; limit: number };
};

/**
 * Busca órdenes para un seller, ordenadas por date_created ascendente.
 * Endpoint: GET /orders/search
 *
 * Cursor por date_created porque ML solo soporta sort=date_asc/desc.
 * El filtro adicional por date_closed asegura que solo nos interese
 * órdenes que efectivamente cerraron (status paid/partially_paid).
 * La agrupación por mes en la vista usa date_closed (que es la fecha
 * que alinea con la emisión del comprobante en ARCA).
 */
export async function searchOrders(opts: {
  accessToken: string;
  sellerId: number;
  desde: string;       // ISO 8601 (date_created.from)
  hasta?: string;
  limit?: number;
  offset?: number;
}): Promise<SearchResponse> {
  const params = new URLSearchParams({
    seller: String(opts.sellerId),
    sort: "date_asc",
    "order.date_created.from": opts.desde,
    limit: String(Math.min(opts.limit ?? 50, 50)),
    offset: String(opts.offset ?? 0),
  });
  if (opts.hasta) params.set("order.date_created.to", opts.hasta);

  const url = `${ML_API_BASE}/orders/search?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${opts.accessToken}`,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ML /orders/search ${res.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as SearchResponse;
}

/** Datos básicos del usuario logueado (útil para confirmar el seller_id + site_id). */
export async function getMe(accessToken: string): Promise<{ id: number; nickname?: string; email?: string; site_id?: string }> {
  const res = await fetch(`${ML_API_BASE}/users/me`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ML /users/me ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/**
 * Datos de facturación del comprador de una orden.
 * Endpoint: GET /orders/{order_id}/billing_info
 *
 * Devuelve doc_type ("DNI" | "CUIT" | "CUIL" | "CDI" | "Otro") y doc_number,
 * además de razón social y dirección. Para órdenes a "Consumidor Final" sin
 * datos de facturación, los campos pueden venir vacíos o null.
 */
export type MlBillingInfo = {
  doc_type?: string;
  doc_number?: string;
  business_name?: string;
  first_name?: string;
  last_name?: string;
  address?: unknown;
};

export async function getBillingInfo(
  accessToken: string,
  orderId: number,
): Promise<MlBillingInfo | null> {
  const res = await fetch(`${ML_API_BASE}/orders/${orderId}/billing_info`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ML /orders/${orderId}/billing_info ${res.status}: ${text.slice(0, 300)}`);
  }
  const parsed = JSON.parse(text) as { billing_info?: MlBillingInfo } & MlBillingInfo;
  // ML envuelve a veces en { billing_info: {...} } y a veces lo tira plano
  return parsed.billing_info ?? parsed ?? null;
}

