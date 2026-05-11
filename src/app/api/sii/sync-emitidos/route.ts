import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/arca/auth";
import { syncResumenEmitidos, syncDetalleEmitidos } from "@/lib/sii/sync-emitidos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  meses?: number;
  periodo?: string;
  /** Si true, sincroniza también el detalle (factura por factura). */
  detalle?: boolean;
  /** Para sync detalle: periodo YYYYMM desde el que arrancar (default 202601). */
  desde?: string;
};

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
    .from("sii_sync_runs")
    .insert({ user_id: userId, status: "running" })
    .select("id")
    .single();

  try {
    // 1. Siempre sincronizar el resumen mensual
    const resumen = await syncResumenEmitidos(supabase, userId, {
      meses: body.meses,
      periodo: body.periodo,
    });

    // 2. Si se pide, también sincronizar el detalle (factura por factura)
    let detalleRes:
      | { periodosSincronizados: number; comprobantesUpsert: number; porTipo: Record<string, number>; errores: string[] }
      | null = null;
    if (body.detalle) {
      detalleRes = await syncDetalleEmitidos(supabase, userId, {
        desde: body.desde ?? "202601",
      });
    }

    const erroresTotales = [
      ...resumen.errores,
      ...(detalleRes?.errores ?? []),
    ];
    const periodosTotal = resumen.periodosSincronizados + (detalleRes?.periodosSincronizados ?? 0);
    const filasTotal = resumen.filasActualizadas + (detalleRes?.comprobantesUpsert ?? 0);
    const status = erroresTotales.length > 0 && periodosTotal === 0 ? "error" : "ok";

    await supabase
      .from("sii_sync_runs")
      .update({
        status,
        finished_at: new Date().toISOString(),
        periodos_sincronizados: periodosTotal,
        filas_actualizadas: filasTotal,
        error_mensaje: erroresTotales.length > 0 ? erroresTotales.join(" | ").slice(0, 4000) : null,
        raw: { resumen, detalle: detalleRes } as unknown as object,
      })
      .eq("id", run?.id);

    return NextResponse.json({
      ok: true,
      via: auth.via,
      ...resumen,
      ...(detalleRes ? { comprobantesUpsert: detalleRes.comprobantesUpsert, detallePorTipo: detalleRes.porTipo } : {}),
    });
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
