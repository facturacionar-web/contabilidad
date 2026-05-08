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
 * Busca órdenes para un seller. Soporta filtro por fecha y paginación.
 * Endpoint: GET /orders/search
 *
 * Ojo: para paginar más de 1000 órdenes ML pide usar `sort` por fecha y
 * `order.date_created.from/to` (no soporta offset > 1000 con ciertos sorts).
 */
export async function searchOrders(opts: {
  accessToken: string;
  sellerId: number;
  desde: string;       // ISO 8601 con timezone offset
  hasta?: string;      // si no se pasa, usa "now"
  limit?: number;      // max 50 por la API
  offset?: number;     // 0..1000
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

/** Datos básicos del usuario logueado (útil para confirmar el seller_id). */
export async function getMe(accessToken: string): Promise<{ id: number; nickname?: string; email?: string }> {
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
