import { Agent, fetch as undiciFetch } from "undici";
import { URLS, SII_ENV, getCredentials } from "./config";

/**
 * Cliente HTTP con mTLS (cert client-side) y manejo manual de cookies.
 * El portal del SII Chile usa SSL mutuo: el cert .pfx del contribuyente
 * se presenta en el TLS handshake. Sin eso, todas las requests al portal
 * redirigen al login de RUT/clave.
 */
export type SiiClient = {
  dispatcher: Agent;
  cookies: Map<string, string>;
  token: string | null;
};

function makeDispatcher(certPem: string, keyPem: string): Agent {
  return new Agent({
    connect: {
      cert: certPem,
      key: keyPem,
    },
  });
}

function parseSetCookieHeader(setCookie: string | string[] | null): Array<[string, string]> {
  if (!setCookie) return [];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  const out: Array<[string, string]> = [];
  for (const raw of arr) {
    const firstPair = raw.split(";")[0];
    const eq = firstPair.indexOf("=");
    if (eq === -1) continue;
    const name = firstPair.slice(0, eq).trim();
    const value = firstPair.slice(eq + 1).trim();
    if (name) out.push([name, value]);
  }
  return out;
}

function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function fetchWithClient(
  client: SiiClient,
  url: string,
  init: { method?: "GET" | "POST"; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; text: string; headers: Headers }> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "es-CL,es;q=0.9",
    ...(init.headers ?? {}),
  };
  if (client.cookies.size > 0) {
    headers.Cookie = cookieHeader(client.cookies);
  }

  const res = await undiciFetch(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    dispatcher: client.dispatcher,
    redirect: "follow",
  });

  const setCookieRaw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie");

  for (const [name, value] of parseSetCookieHeader(setCookieRaw as string | string[] | null)) {
    client.cookies.set(name, value);
  }

  const text = await res.text();
  return { status: res.status, text, headers: res.headers as unknown as Headers };
}

/**
 * Autentica al portal del SII con el certificado digital (mTLS).
 * Devuelve un cliente con cookies de sesión válidas para llamadas posteriores.
 */
export async function authenticateToPortal(destino?: string): Promise<SiiClient> {
  const { certPem, keyPem } = getCredentials();
  const urls = URLS[SII_ENV];
  const dest = destino ?? urls.portal;

  const client: SiiClient = {
    dispatcher: makeDispatcher(certPem, keyPem),
    cookies: new Map(),
    token: null,
  };

  // 1. POST a CAutInicio.cgi con el cert client-side. Setea TOKEN, CSESSIONID, NETSCAPE_LIVEWIRE.*
  const body = new URLSearchParams({ referencia: dest }).toString();
  const authRes = await fetchWithClient(client, `${urls.auth}?${dest}`, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (authRes.status >= 400) {
    throw new Error(
      `SII auth fail: HTTP ${authRes.status}. Body: ${authRes.text.slice(0, 300)}`,
    );
  }

  // 2. GET al portal del RCV. Asegura que las cookies estén alineadas con www4.sii.cl
  await fetchWithClient(client, urls.portal);

  client.token = client.cookies.get("TOKEN") ?? null;
  if (!client.token) {
    throw new Error("SII auth: no se obtuvo cookie TOKEN. Posibles causas: cert inválido, cert no autorizado en SII, ambiente equivocado.");
  }
  return client;
}

/**
 * POST autenticado contra un endpoint del facade service del RCV.
 */
export async function postFacade<T = unknown>(
  client: SiiClient,
  endpoint: string,
  payload: object,
): Promise<T> {
  const urls = URLS[SII_ENV];
  const res = await fetchWithClient(client, `${urls.rcvFacade}/${endpoint}`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
      Accept: "*/*",
      Origin: "https://www4.sii.cl",
      Referer: urls.portal,
    },
  });

  if (res.status >= 400) {
    throw new Error(
      `SII facade ${endpoint} HTTP ${res.status}: ${res.text.slice(0, 400)}`,
    );
  }

  try {
    return JSON.parse(res.text) as T;
  } catch {
    throw new Error(
      `SII facade ${endpoint}: respuesta no es JSON. Body: ${res.text.slice(0, 400)}`,
    );
  }
}
