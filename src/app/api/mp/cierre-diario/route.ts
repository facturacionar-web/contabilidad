import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/arca/auth";
import { cerrarDiaMp } from "@/lib/mp/cierre-diario";

export const dynamic = "force-dynamic";
export const maxDuration = 600;  // hasta 10 min: pide release_report y pollea

/**
 * POST /api/mp/cierre-diario
 * Body opcional: { fecha?: "YYYY-MM-DD" }   (default: ayer en hora AR)
 *
 * Cierra contablemente el día indicado:
 *  1. Pide release_report a MP para el día.
 *  2. Pollea hasta processed (~1-5 min según volumen).
 *  3. Descarga CSV, parsea, inserta filas en mp_release_detail.
 *  4. Crea UN ingreso en `ingresos` (cuenta MP) con el neto del día (sin payouts).
 *  5. Por cada payout (transferencia MP→banco) crea:
 *      - 1 gasto  en cuenta MP    (con contacto LIBRENTA proveedor)
 *      - 1 ingreso en cuenta destino (si CBU mapeada)
 *      - 1 fila en mp_withdrawals (link a ambos)
 *  6. Inserta fila en mp_liquidaciones_diarias.
 *
 * Idempotente: si el día ya tiene mp_liquidaciones_diarias, no hace nada.
 *
 * Auth dual: cookie de sesión o Bearer CRON_SECRET.
 */
export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { supabase, userId } = auth;

  let body: { fecha?: string } = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  const fecha = body.fecha ?? ayerEnAR();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json(
      { ok: false, error: `fecha inválida: '${fecha}'. Formato: YYYY-MM-DD.` },
      { status: 400 },
    );
  }

  try {
    const result = await cerrarDiaMp(supabase, userId, fecha);
    return NextResponse.json({ ok: true, via: auth.via, ...result });
  } catch (err) {
    const msg = String(err);
    console.error("[mp/cierre-diario] ERROR:", msg);
    return NextResponse.json({ ok: false, error: msg, fecha }, { status: 500 });
  }
}

/** YYYY-MM-DD de ayer en zona AR (UTC-3, sin DST). */
function ayerEnAR(): string {
  const offsetMs = 3 * 60 * 60 * 1000;
  const nowAr = new Date(Date.now() - offsetMs);
  nowAr.setUTCDate(nowAr.getUTCDate() - 1);
  return nowAr.toISOString().slice(0, 10);
}
