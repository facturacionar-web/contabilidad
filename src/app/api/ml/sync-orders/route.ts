import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/arca/auth";
import { syncOrdenesMl } from "@/lib/ml/sync-orders";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/ml/sync-orders
 * Body opcional: { desdeOverride?: "ISO datetime", maxPorTanda?: number }
 *
 * Sincroniza órdenes nuevas desde ML para todos los sellers autorizados.
 * Auth dual: cookie de sesión (botón "Actualizar") o Bearer CRON_SECRET (cron).
 */
export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { supabase, userId } = auth;

  let body: { desdeOverride?: string; maxPorTanda?: number } = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  const { data: run } = await supabase
    .from("ml_sync_runs")
    .insert({ user_id: userId, status: "running" })
    .select("id")
    .single();

  try {
    const result = await syncOrdenesMl(supabase, userId, body);

    await supabase
      .from("ml_sync_runs")
      .update({
        status: result.errores.length > 0 && result.ordenesNuevas === 0 ? "error" : "ok",
        finished_at: new Date().toISOString(),
        ordenes_nuevas: result.ordenesNuevas,
        error_mensaje: result.errores.length > 0 ? result.errores.join(" | ") : null,
        raw: result as unknown as object,
      })
      .eq("id", run?.id);

    // Refrescar materialized views si trajimos algo nuevo
    if (result.ordenesNuevas > 0) {
      try {
        await supabase.rpc("refresh_resumen_views");
      } catch (e) {
        console.warn("[ml/sync-orders] refresh_resumen_views falló:", String(e));
      }
    }

    return NextResponse.json({ ok: true, via: auth.via, ...result });
  } catch (err) {
    const msg = String(err);
    await supabase
      .from("ml_sync_runs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error_mensaje: msg,
      })
      .eq("id", run?.id);
    console.error("[ml/sync-orders] ERROR:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
