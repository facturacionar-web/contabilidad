import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/arca/auth";
import { syncComprobantesEmitidos } from "@/lib/arca/sync-emitidos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { supabase, userId } = auth;

  let body: { ptosVenta?: number[]; cbteTipos?: number[]; maxPorPunto?: number } = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  const { data: run } = await supabase
    .from("arca_sync_runs")
    .insert({ user_id: userId, status: "running" })
    .select("id")
    .single();

  try {
    const result = await syncComprobantesEmitidos(supabase, userId, body);

    await supabase
      .from("arca_sync_runs")
      .update({
        status: result.errores.length > 0 && result.comprobantesNuevos === 0 ? "error" : "ok",
        finished_at: new Date().toISOString(),
        comprobantes_nuevos: result.comprobantesNuevos,
        error_mensaje: result.errores.length > 0 ? result.errores.join(" | ") : null,
        raw: result as unknown as object,
      })
      .eq("id", run?.id);

    // Refrescar materialized views si trajimos algo nuevo
    if (result.comprobantesNuevos > 0) {
      try {
        await supabase.rpc("refresh_resumen_views");
      } catch (e) {
        console.warn("[arca/sync-emitidos] refresh_resumen_views falló:", String(e));
      }
    }

    return NextResponse.json({ ok: true, via: auth.via, ...result });
  } catch (err) {
    const msg = String(err);
    await supabase
      .from("arca_sync_runs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error_mensaje: msg,
      })
      .eq("id", run?.id);
    console.error("[arca/sync-emitidos] ERROR:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
