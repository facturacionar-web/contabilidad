import { createClient as createSbClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase con service-role key. Bypasea RLS, así que SIEMPRE
 * hay que setear `user_id` manualmente en cada operación.
 *
 * Uso solo desde rutas autenticadas con CRON_SECRET (jobs automatizados).
 * Nunca exponer al browser.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Faltan env vars NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  return createSbClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
