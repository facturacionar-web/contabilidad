import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { buildAuthorizationUrl } from "@/lib/ml/oauth";
import type { MlCountry } from "@/lib/ml/config";

export const dynamic = "force-dynamic";

const VALID_COUNTRIES = new Set<MlCountry>(["AR", "CL", "MX", "BR", "CO", "UY", "PE"]);

/**
 * GET /api/ml/oauth/start[?country=CL]
 * Redirige al login de Mercado Libre del país correspondiente para autorizar
 * la app. Default: AR (retrocompatible con flow anterior).
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ ok: false, error: "no autenticado" }, { status: 401 });
  }

  const countryParam = new URL(req.url).searchParams.get("country")?.toUpperCase() as MlCountry | null;
  const country: MlCountry = countryParam && VALID_COUNTRIES.has(countryParam) ? countryParam : "AR";

  const state = crypto.randomBytes(16).toString("hex");
  const url = buildAuthorizationUrl(state, country);

  const res = NextResponse.redirect(url);
  res.cookies.set("ml_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });
  return res;
}
