import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/arca/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/refresh-views
 * Refresca las materialized views de resumen (ARCA y ML).
 * Necesario si modificás datos directamente en la BD sin pasar por los syncs.
 */
export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;

  // Refrescamos cada MV en su propia llamada PostgREST para que cada
  // una tenga su propio timeout del API gateway (~10s). Antes se hacía
  // en una sola RPC y la suma de los 3 pegaba contra el límite.
  const fns = [
    "refresh_arca_resumen_mensual",
    "refresh_ml_resumen_mensual",
    "refresh_ml_resumen_mensual_seller",
  ] as const;

  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const errors: Record<string, string> = {};

  for (const fn of fns) {
    const ti = Date.now();
    const { error } = await supabase.rpc(fn);
    timings[fn] = Date.now() - ti;
    if (error) errors[fn] = error.message;
  }

  const failed = Object.keys(errors).length > 0;
  return NextResponse.json(
    {
      ok: !failed,
      via: auth.via,
      ms: Date.now() - t0,
      timings,
      ...(failed ? { errors } : {}),
    },
    { status: failed ? 500 : 200 },
  );
}
