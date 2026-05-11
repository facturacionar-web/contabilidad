import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/arca/auth";
import { syncResumenEmitidos } from "@/lib/sii/sync-emitidos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { supabase, userId } = auth;

  let body: { meses?: number; periodo?: string } = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  const { data: run } = await supabase
    .from("sii_sync_runs")
    .insert({ user_id: userId, status: "running" })
    .select("id")
    .single();

  try {
    const result = await syncResumenEmitidos(supabase, userId, body);

    const status =
      result.errores.length > 0 && result.periodosSincronizados === 0 ? "error" : "ok";

    await supabase
      .from("sii_sync_runs")
      .update({
        status,
        finished_at: new Date().toISOString(),
        periodos_sincronizados: result.periodosSincronizados,
        filas_actualizadas: result.filasActualizadas,
        error_mensaje: result.errores.length > 0 ? result.errores.join(" | ") : null,
        raw: result as unknown as object,
      })
      .eq("id", run?.id);

    return NextResponse.json({ ok: true, via: auth.via, ...result });
  } catch (err) {
    const msg = String(err);
    await supabase
      .from("sii_sync_runs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error_mensaje: msg,
      })
      .eq("id", run?.id);
    console.error("[sii/sync-emitidos] ERROR:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
