import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/arca/auth";
import { syncCalendar } from "@/lib/mp/calendar-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/mp/sync-calendar
 * Body opcional: { diasHaciaAtras?: number; diasHaciaAdelante?: number }
 *
 * Refresca `mp_release_calendar` con los pagos cuyo money_release_date cae
 * en el rango. Default: -7d a +60d. Es la fuente del widget "Calendario de
 * movimientos" en el dashboard.
 *
 * Auth dual: cookie de sesión o Bearer CRON_SECRET (cron N8N).
 */
export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { supabase, userId } = auth;

  let body: { diasHaciaAtras?: number; diasHaciaAdelante?: number; mpUserId?: number } = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  try {
    const result = await syncCalendar(supabase, userId, body);
    return NextResponse.json({ ok: true, via: auth.via, ...result });
  } catch (err) {
    const msg = String(err);
    console.error("[mp/sync-calendar] ERROR:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
