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

    // Refrescar las MVs de ML si trajimos algo nuevo.
    // Las hacemos una por una (no en una sola RPC) para que cada llamada
    // tenga su propio timeout del API gateway (~10s) — antes se sumaban
    // y pegaban contra el límite.
    const refreshErrors: string[] = [];
    if (result.ordenesNuevas > 0) {
      for (const fn of ["refresh_ml_resumen_mensual", "refresh_ml_resumen_mensual_seller"]) {
        const { error } = await supabase.rpc(fn);
        if (error) {
          refreshErrors.push(`${fn}: ${error.message}`);
          console.error(`[ml/sync-orders] ${fn} falló:`, error.message);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      via: auth.via,
      refreshError: refreshErrors.length > 0 ? refreshErrors.join(" | ") : null,
      ...result,
    });
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
