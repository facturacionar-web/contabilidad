import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type ResolvedAuth =
  | { ok: true; supabase: SupabaseClient; userId: string; via: "session" | "cron" }
  | { ok: false; status: number; error: string };

/**
 * Resuelve la autenticación de un endpoint ARCA.
 *
 * Los datos de ARCA son de la EMPRESA (un solo CUIT en env vars), no de
 * cada usuario individual. Por eso, sin importar quién llama, el endpoint
 * siempre escribe/lee con `CRON_USER_ID` y usa el cliente service-role
 * (que bypasea RLS). Eso garantiza que todos los usuarios autenticados ven
 * exactamente los mismos comprobantes.
 *
 * Dos modos de auth (solo cambia cómo verifico al caller, no el user_id):
 *   1. Bearer token con CRON_SECRET (cron de N8N).
 *   2. Sesión Supabase (cookie) — cualquier usuario autenticado de la app.
 *
 * Si ninguna funciona, devuelve un error con el código HTTP apropiado.
 */
export async function resolveAuth(req: NextRequest): Promise<ResolvedAuth> {
  const auth = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const cronUserId = process.env.CRON_USER_ID;

  if (!cronUserId) {
    return { ok: false, status: 500, error: "CRON_USER_ID no configurado" };
  }

  if (auth?.startsWith("Bearer ") && cronSecret) {
    const token = auth.slice(7).trim();
    if (token === cronSecret) {
      return { ok: true, supabase: createAdminClient(), userId: cronUserId, via: "cron" };
    }
    return { ok: false, status: 401, error: "bearer token inválido" };
  }

  // Sesión normal: solo verifico que esté autenticado. El user_id que uso
  // para escribir es siempre CRON_USER_ID (la empresa).
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) {
    return { ok: false, status: 401, error: "no autenticado" };
  }
  return { ok: true, supabase: createAdminClient(), userId: cronUserId, via: "session" };
}
