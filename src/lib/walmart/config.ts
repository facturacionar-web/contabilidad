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

/** Estados de orden a iterar (Chile solo expone Created y Acknowledged). */
export const WALMART_STATUSES = ["Created", "Acknowledged"] as const;
export type WalmartStatus = (typeof WALMART_STATUSES)[number];
