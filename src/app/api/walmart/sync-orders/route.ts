import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/arca/auth";
import { syncWalmartOrders } from "@/lib/walmart/sync-orders";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = { dias?: number; createdStart?: string; createdEnd?: string };

export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { supabase, userId } = auth;

  let body: Body = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  const { data: run } = await supabase
    .from("walmart_sync_runs")
    .insert({ user_id: userId, status: "running", desde_iso: body.createdStart ?? null, hasta_iso: body.createdEnd ?? null })
    .select("id")
    .single();

  try {
    const result = await syncWalmartOrders(supabase, userId, body);
    const status = result.errores.length > 0 && result.ordenesUpsert === 0 ? "error" : "ok";
    await supabase
      .from("walmart_sync_runs")
      .update({
        status,
        finished_at: new Date().toISOString(),
        ordenes_upsert: result.ordenesUpsert,
        lines_upsert: result.linesUpsert,
        desde_iso: result.rango.desde,
        hasta_iso: result.rango.hasta,
        error_mensaje: result.errores.length > 0 ? result.errores.join(" | ").slice(0, 4000) : null,
        raw: result as unknown as object,
      })
      .eq("id", run?.id);

    return NextResponse.json({ ok: true, via: auth.via, ...result });
  } catch (err) {
    const msg = String(err);
    await supabase
      .from("walmart_sync_runs")
      .update({ status: "error", finished_at: new Date().toISOString(), error_mensaje: msg })
      .eq("id", run?.id);
    console.error("[walmart/sync-orders] ERROR:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
