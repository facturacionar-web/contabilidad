import { MP_API_BASE } from "./config";

/** Wrapper de fetch a la API de MP. Levanta error con el body si !ok. */
export async function mpFetch(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${MP_API_BASE}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  return fetch(url, { ...init, headers });
}

/** Igual que mpFetch pero parsea JSON y tira error con detalle si !ok. */
export async function mpJson<T = unknown>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await mpFetch(accessToken, path, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MP ${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}
