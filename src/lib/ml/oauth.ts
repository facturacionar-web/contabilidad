import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthUrlFor, ML_TOKEN_URL, getMlCredentials, type MlCountry } from "./config";

export type MlTokens = {
  mlUserId: number;
  accessToken: string;
  refreshToken: string;
  expiraAt: Date;
  scope?: string;
};

/**
 * URL para iniciar el flow OAuth. El user va acá, autoriza, y ML redirige
 * al callback con un `code`.
 *
 * @param country país donde el user hace login (AR/CL/MX/...). La misma app
 *                puede autorizar cuentas de cualquier país.
 */
export function buildAuthorizationUrl(state: string, country: MlCountry = "AR"): string {
  const { clientId, redirectUri } = getMlCredentials();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `${getAuthUrlFor(country)}?${params.toString()}`;
}

/** Intercambia el `code` del callback por access+refresh tokens. */
export async function exchangeCodeForTokens(code: string): Promise<MlTokens> {
  const { clientId, clientSecret, redirectUri } = getMlCredentials();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(ML_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`ML OAuth exchange failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return {
    mlUserId: Number(json.user_id),
    accessToken: String(json.access_token),
    refreshToken: String(json.refresh_token),
    expiraAt: new Date(Date.now() + Number(json.expires_in ?? 21600) * 1000),
    scope: json.scope ? String(json.scope) : undefined,
  };
}

/** Refresca el access_token usando el refresh_token. */
export async function refreshAccessToken(refreshToken: string): Promise<MlTokens> {
  const { clientId, clientSecret } = getMlCredentials();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const res = await fetch(ML_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`ML refresh failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return {
    mlUserId: Number(json.user_id),
    accessToken: String(json.access_token),
    refreshToken: String(json.refresh_token),
    expiraAt: new Date(Date.now() + Number(json.expires_in ?? 21600) * 1000),
    scope: json.scope ? String(json.scope) : undefined,
  };
}

/** Persiste tokens en `ml_oauth_cache` (upsert por user_id+ml_user_id). */
export async function saveTokens(
  supabase: SupabaseClient,
  userId: string,
  tokens: MlTokens,
  nickname?: string,
): Promise<void> {
  const row: Record<string, unknown> = {
    user_id: userId,
    ml_user_id: tokens.mlUserId,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expira_at: tokens.expiraAt.toISOString(),
    scope: tokens.scope ?? null,
    updated_at: new Date().toISOString(),
  };
  if (nickname) row.nickname = nickname;

  const { error } = await supabase
    .from("ml_oauth_cache")
    .upsert(row, { onConflict: "user_id,ml_user_id" });
  if (error) {
    throw new Error(`No se pudo guardar tokens ML: ${error.message}`);
  }
}

/**
 * Devuelve un access_token válido para el seller indicado. Si está vencido o
 * cerca de vencer, lo refresca automáticamente y persiste el nuevo refresh.
 *
 * Como side-effect: si el nickname está vacío, lo trae con /users/me y lo guarda.
 */
export async function getAccessToken(
  supabase: SupabaseClient,
  userId: string,
  mlUserId: number,
): Promise<string> {
  const { data, error } = await supabase
    .from("ml_oauth_cache")
    .select("access_token, refresh_token, expira_at, nickname")
    .eq("user_id", userId)
    .eq("ml_user_id", mlUserId)
    .maybeSingle();

  if (error) throw new Error(`Lectura de ml_oauth_cache: ${error.message}`);
  if (!data) {
    throw new Error(
      `No hay tokens ML para ml_user_id=${mlUserId}. Hay que reautorizar la app desde /api/ml/oauth/start.`,
    );
  }

  const margin = 5 * 60 * 1000;
  let accessToken = data.access_token;
  if (new Date(data.expira_at).getTime() <= Date.now() + margin) {
    const refreshed = await refreshAccessToken(data.refresh_token);
    await saveTokens(supabase, userId, refreshed, data.nickname ?? undefined);
    accessToken = refreshed.accessToken;
  }

  // Si el nickname todavía no se guardó, traerlo y persistir.
  if (!data.nickname) {
    try {
      const { ML_API_BASE } = await import("./config");
      const meRes = await fetch(`${ML_API_BASE}/users/me`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
      });
      if (meRes.ok) {
        const me = (await meRes.json()) as { nickname?: string };
        if (me.nickname) {
          await supabase
            .from("ml_oauth_cache")
            .update({ nickname: me.nickname, updated_at: new Date().toISOString() })
            .eq("user_id", userId)
            .eq("ml_user_id", mlUserId);
        }
      }
    } catch {
      // no crítico, seguimos sin nickname
    }
  }

  return accessToken;
}

/**
 * Lista los sellers (ml_user_id) ya autorizados para este user_id.
 * Si solo hay uno, sync usa ese; si hay varios, los recorre todos.
 */
export async function listAuthorizedSellers(
  supabase: SupabaseClient,
  userId: string,
): Promise<number[]> {
  const { data, error } = await supabase
    .from("ml_oauth_cache")
    .select("ml_user_id")
    .eq("user_id", userId);
  if (error) throw new Error(`Lectura de ml_oauth_cache: ${error.message}`);
  return (data ?? []).map((r) => Number(r.ml_user_id));
}
