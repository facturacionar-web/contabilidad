import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/arca/auth";
import { initCheckpointsDesdeFecha } from "@/lib/arca/sync-emitidos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/arca/init-checkpoints
 * Body: { fechaDesde: "YYYY-MM-DD", ptosVenta?: number[], cbteTipos?: number[] }
 *
 * Setea los checkpoints en (primer_cbte_nro_con_fecha_>=_fechaDesde - 1) para
 * cada (PtoVta, Tipo). Después el sync solo trae lo nuevo desde esa fecha.
 */
export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { supabase, userId } = auth;

  let body: { fechaDesde?: string; ptosVenta?: number[]; cbteTipos?: number[] } = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  if (!body.fechaDesde) {
    return NextResponse.json(
      { ok: false, error: "falta fechaDesde (formato YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  try {
    const result = await initCheckpointsDesdeFecha(supabase, userId, body.fechaDesde, {
      ptosVenta: body.ptosVenta,
      cbteTipos: body.cbteTipos,
    });
    return NextResponse.json({ ok: true, via: auth.via, ...result });
  } catch (err) {
    const msg = String(err);
    console.error("[arca/init-checkpoints] ERROR:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
