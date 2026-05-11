/**
 * Falabella Seller Center API (heredada de Linio).
 * Doc: https://developers.falabella.com/
 *
 * Auth: HMAC-SHA256 con UserID + APIKey. Cada request es GET con query string firmado.
 */

export type FalabellaCountry = "CL" | "PE" | "CO" | "MX";

// Falabella consolidó todos los marketplaces ex-Linio bajo un único host.
// El país se identifica por el UserID/credenciales, no por el dominio.
const HOST_UNIFICADO = "https://sellercenter-api.falabella.com";

const URLS: Record<FalabellaCountry, string> = {
  CL: HOST_UNIFICADO,
  PE: HOST_UNIFICADO,
  CO: HOST_UNIFICADO,
  MX: HOST_UNIFICADO,
};

export function getCountry(): FalabellaCountry {
  const c = (process.env.FALABELLA_COUNTRY ?? "CL").toUpperCase() as FalabellaCountry;
  if (!(c in URLS)) throw new Error(`FALABELLA_COUNTRY inválido: ${c}`);
  return c;
}

export function getBaseUrl(): string {
  return URLS[getCountry()];
}

export function getCredentials() {
  const userId = process.env.FALABELLA_USER_ID;
  const apiKey = process.env.FALABELLA_API_KEY;
  if (!userId || !apiKey) {
    throw new Error("Faltan env vars: FALABELLA_USER_ID, FALABELLA_API_KEY");
  }
  return { userId, apiKey };
}

export const FALABELLA_API_VERSION = "1.0";

/** Estados conocidos del ciclo de vida de una orden. */
export const FALABELLA_ORDER_STATUSES = [
  "pending",
  "canceled",
  "ready_to_ship",
  "delivered",
  "returned",
  "shipped",
  "failed",
] as const;
export type FalabellaOrderStatus = (typeof FALABELLA_ORDER_STATUSES)[number];
