import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncComprobantesEmitidos } from "@/lib/arca/sync-emitidos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;
  if (!user) {
    return NextResponse.json({ ok: false, error: "no autenticado" }, { status: 401 });
  }

  let body: { ptosVenta?: number[]; cbteTipos?: number[]; maxPorPunto?: number } = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  const { data: run } = await supabase
    .from("arca_sync_runs")
    .insert({ user_id: user.id, status: "running" })
    .select("id")
    .single();

  try {
    const result = await syncComprobantesEmitidos(supabase, user.id, body);

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

    return NextResponse.json({ ok: true, ...result });
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
