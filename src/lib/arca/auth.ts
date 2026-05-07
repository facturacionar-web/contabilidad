import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type ResolvedAuth =
  | { ok: true; supabase: SupabaseClient; userId: string; via: "session" | "cron" }
  | { ok: false; status: number; error: string };

/**
 * Resuelve la autenticación de un endpoint ARCA. Soporta dos modos:
 *
 *   1. Sesión normal (cookie de Supabase auth). Para llamadas desde el browser.
 *   2. Bearer token con CRON_SECRET. Para jobs externos (N8N, GitHub Actions, etc).
 *      En este caso usa CRON_USER_ID como user_id y un cliente con service-role
 *      (que bypasea RLS).
 *
 * Si ninguna funciona, devuelve un error con el código HTTP apropiado.
 */
export async function resolveAuth(req: NextRequest): Promise<ResolvedAuth> {
  const auth = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const cronUserId = process.env.CRON_USER_ID;

  if (auth?.startsWith("Bearer ") && cronSecret) {
    const token = auth.slice(7).trim();
    if (token === cronSecret) {
      if (!cronUserId) {
        return { ok: false, status: 500, error: "CRON_USER_ID no configurado" };
      }
      return { ok: true, supabase: createAdminClient(), userId: cronUserId, via: "cron" };
    }
    return { ok: false, status: 401, error: "bearer token inválido" };
  }

  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) {
    return { ok: false, status: 401, error: "no autenticado" };
  }
  return { ok: true, supabase, userId: userRes.user.id, via: "session" };
}
