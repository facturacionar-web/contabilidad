/**
 * Configuración de la integración con la API de Mercado Libre.
 * Usa OAuth2 con app del Devcenter (developers.mercadolibre.com.ar).
 */

export const ML_AUTH_URL = "https://auth.mercadolibre.com.ar/authorization";
export const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
export const ML_API_BASE = "https://api.mercadolibre.com";

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
