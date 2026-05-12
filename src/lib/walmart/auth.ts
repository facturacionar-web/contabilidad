/**
 * OAuth client_credentials de Walmart Marketplace.
 *
 * El token dura 15 min. Lo cacheamos en Supabase walmart_token_cache para
 * que las llamadas concurrentes/rápidas no peguen siempre a /token.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WALMART_BASE_URL, WALMART_MARKET, getCredentials } from "./config";

export type WalmartToken = {
  accessToken: string;
  expiresAt: Date;
};

/** Extrae <accessToken>...</accessToken> de la respuesta XML del /token. */
function parseTokenXml(xml: string): string {
  // El response viene como XML pero a veces como JSON dependiendo del Accept header.
  // Probamos JSON primero (lo pedimos con Accept: application/json).
  try {
    const j = JSON.parse(xml) as { access_token?: string };
    if (j.access_token) return j.access_token;
  } catch {
    // no era JSON, sigo con XML
  }
  const m = xml.match(/<access_token>([^<]+)<\/access_token>/) ?? xml.match(/<accessToken>([^<]+)<\/accessToken>/);
  if (!m) throw new Error(`Walmart /token: no se pudo parsear access_token. Body: ${xml.slice(0, 300)}`);
  return m[1];
}

async function requestNewToken(): Promise<WalmartToken> {
  const { clientId, clientSecret } = getCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${WALMART_BASE_URL}/v3/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "WM_SVC.NAME": "Walmart Marketplace",
      "WM_QOS.CORRELATION_ID": randomUUID(),
      WM_MARKET: WALMART_MARKET,
    },
    body: "grant_type=client_credentials",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Walmart /token HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const accessToken = parseTokenXml(text);
  // Conservador: el token dura 15 min, cacheamos 14 para margen.
  return { accessToken, expiresAt: new Date(Date.now() + 14 * 60 * 1000) };
}

/** Trae un token válido. Cachea en Supabase para llamadas posteriores. */
export async function getAccessToken(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data: cached } = await supabase
    .from("walmart_token_cache")
    .select("access_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (cached && new Date(cached.expires_at).getTime() > Date.now() + 30_000) {
    return cached.access_token as string;
  }

  const fresh = await requestNewToken();

  await supabase.from("walmart_token_cache").upsert({
    user_id: userId,
    access_token: fresh.accessToken,
    expires_at: fresh.expiresAt.toISOString(),
    updated_at: new Date().toISOString(),
  });

  return fresh.accessToken;
}

/** Headers obligatorios para cualquier request al API de Walmart Marketplace. */
export function buildHeaders(accessToken: string): Record<string, string> {
  const { clientId, clientSecret } = getCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  return {
    Authorization: `Basic ${basic}`,
    "WM_SEC.ACCESS_TOKEN": accessToken,
    "WM_SVC.NAME": "Walmart Marketplace",
    "WM_QOS.CORRELATION_ID": randomUUID(),
    WM_MARKET: WALMART_MARKET,
    Accept: "application/json",
  };
}
