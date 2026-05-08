import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { buildAuthorizationUrl } from "@/lib/ml/oauth";

export const dynamic = "force-dynamic";

/**
 * GET /api/ml/oauth/start
 * Redirige al login de Mercado Libre para autorizar la app. Cuando termine,
 * ML redirige a /api/ml/oauth/callback con un `code`.
 *
 * Requiere sesión (solo el dueño autenticado puede iniciar el flow).
 */
export async function GET() {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ ok: false, error: "no autenticado" }, { status: 401 });
  }

  const state = crypto.randomBytes(16).toString("hex");
  const url = buildAuthorizationUrl(state);

  // Guardamos el state en cookie httpOnly para validar en el callback
  const res = NextResponse.redirect(url);
  res.cookies.set("ml_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 10, // 10 min para completar el flow
    path: "/",
  });
  return res;
}
