/**
 * Firma HMAC-SHA256 de requests a Falabella Seller Center.
 *
 * Algoritmo (según developers.falabella.com/reference/signing-requests):
 *   1. Ordenar parámetros por nombre (asc)
 *   2. URL-encodear cada nombre y valor (RFC 3986)
 *   3. Concatenar como nombre=valor, unidos con '&'
 *   4. HMAC-SHA256 con APIKey como secreto
 *   5. URL-encodear el resultado y agregar como Signature
 */
import crypto from "node:crypto";
import { FALABELLA_API_VERSION, getBaseUrl, getCredentials } from "./config";

/** RFC 3986 percent-encoding (más estricto que encodeURIComponent). */
function rfc3986encode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function nowIsoUtc(): string {
  // Falabella espera ISO 8601 con offset, ej: 2026-05-11T15:00:00+00:00
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`
  );
}

/** Devuelve la URL completa firmada para una acción + params. */
export function buildSignedUrl(
  action: string,
  extraParams: Record<string, string | number | undefined> = {},
  format: "JSON" | "XML" = "JSON",
): string {
  const { userId, apiKey } = getCredentials();

  const params: Record<string, string> = {
    Action: action,
    Format: format,
    Timestamp: nowIsoUtc(),
    UserID: userId,
    Version: FALABELLA_API_VERSION,
  };
  for (const [k, v] of Object.entries(extraParams)) {
    if (v !== undefined && v !== null && v !== "") params[k] = String(v);
  }

  // Ordenar por nombre
  const sortedKeys = Object.keys(params).sort();

  // Construir canonical query string (encoded)
  const canonical = sortedKeys
    .map((k) => `${rfc3986encode(k)}=${rfc3986encode(params[k])}`)
    .join("&");

  // HMAC-SHA256(canonical, apiKey)
  const signature = crypto.createHmac("sha256", apiKey).update(canonical).digest("hex");

  return `${getBaseUrl()}?${canonical}&Signature=${rfc3986encode(signature)}`;
}

/** Llamada genérica al API. Lanza si la respuesta no tiene SuccessResponse. */
export async function callApi<T = unknown>(
  action: string,
  extraParams: Record<string, string | number | undefined> = {},
): Promise<T> {
  const url = buildSignedUrl(action, extraParams, "JSON");
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Falabella ${action} HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  let json: { SuccessResponse?: { Body?: T }; ErrorResponse?: { Head?: { ErrorMessage?: string } } };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Falabella ${action}: respuesta no es JSON. Body: ${text.slice(0, 400)}`);
  }
  if (json.ErrorResponse) {
    const msg = json.ErrorResponse.Head?.ErrorMessage ?? "Error sin mensaje";
    throw new Error(`Falabella ${action} ErrorResponse: ${msg}`);
  }
  if (!json.SuccessResponse?.Body) {
    throw new Error(`Falabella ${action}: respuesta sin SuccessResponse.Body. ${text.slice(0, 400)}`);
  }
  return json.SuccessResponse.Body;
}
