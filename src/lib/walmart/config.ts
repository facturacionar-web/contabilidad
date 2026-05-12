/**
 * Walmart Marketplace API (Chile).
 * Doc: marketplace.walmartapis.com/v3
 *
 * NO es Mirakl. Tiene su propia API basada en OAuth client_credentials.
 * Particularidad de Chile: parámetro `status` (no `orderStatus`) y valores
 * son `Created` y `Acknowledged` (hay que iterar ambos y deduplicar).
 */

export const WALMART_BASE_URL = "https://marketplace.walmartapis.com";
export const WALMART_MARKET = "cl";

export function getCredentials() {
  const clientId = process.env.WALMART_CLIENT_ID;
  const clientSecret = process.env.WALMART_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Faltan env vars: WALMART_CLIENT_ID, WALMART_CLIENT_SECRET");
  }
  return { clientId, clientSecret };
}

/**
 * Estados válidos según docs (no iteramos ninguno — la API acepta omitir `status`
 * y devolver TODAS las órdenes, que es lo que queremos).
 * Los probé en /v3/orders y los volúmenes para LIBRENTA fueron:
 *   sin filtro=3013, Created=7, Acknowledged=37, Shipped=90, Delivered=2880, Cancelled=67
 * (Refunded y PartiallyShipped devolvieron 520 — no soportados en Chile).
 */
export const WALMART_STATUSES = ["Created", "Acknowledged", "Shipped", "Delivered", "Cancelled"] as const;
export type WalmartStatus = (typeof WALMART_STATUSES)[number];
