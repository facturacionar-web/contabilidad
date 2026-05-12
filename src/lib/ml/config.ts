/**
 * Configuración de la integración con la API de Mercado Libre.
 * Usa OAuth2 con app del Devcenter (developers.mercadolibre.com.ar).
 *
 * Multi-país: la misma app puede autorizar cuentas de cualquier país de ML.
 * Lo único que cambia entre países es la URL donde el user hace login.
 * La API REST y el endpoint de token son globales (api.mercadolibre.com).
 */

export type MlCountry = "AR" | "CL" | "MX" | "BR" | "CO" | "UY" | "PE";

const AUTH_URLS: Record<MlCountry, string> = {
  AR: "https://auth.mercadolibre.com.ar/authorization",
  CL: "https://auth.mercadolibre.cl/authorization",
  MX: "https://auth.mercadolibre.com.mx/authorization",
  BR: "https://auth.mercadolivre.com.br/authorization",
  CO: "https://auth.mercadolibre.com.co/authorization",
  UY: "https://auth.mercadolibre.com.uy/authorization",
  PE: "https://auth.mercadolibre.com.pe/authorization",
};

/** Default (compat con código viejo que importa ML_AUTH_URL sin país). */
export const ML_AUTH_URL = AUTH_URLS.AR;

export function getAuthUrlFor(country: MlCountry): string {
  return AUTH_URLS[country] ?? AUTH_URLS.AR;
}

export const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
export const ML_API_BASE = "https://api.mercadolibre.com";

/** Mapping site_id de ML → país. site_id viene en /users/me y en cada orden. */
export const SITE_ID_TO_COUNTRY: Record<string, MlCountry> = {
  MLA: "AR",
  MLC: "CL",
  MLM: "MX",
  MLB: "BR",
  MCO: "CO",
  MLU: "UY",
  MPE: "PE",
};

export function getMlCredentials() {
  const clientId = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  const redirectUri = process.env.ML_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Faltan env vars: ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI",
    );
  }
  return { clientId, clientSecret, redirectUri };
}
