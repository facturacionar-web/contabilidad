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

  try {
    const t0 = Date.now();
    const { error } = await supabase.rpc("refresh_resumen_views");
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, via: auth.via, ms: Date.now() - t0 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
