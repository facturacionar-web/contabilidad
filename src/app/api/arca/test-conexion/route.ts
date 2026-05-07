import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/arca/auth";
import { getAccessTicket } from "@/lib/arca/wsaa";
import { feDummy, feParamGetPtosVenta, feParamGetTiposCbte } from "@/lib/arca/wsfev1";
import { getCredentials, ARCA_ENV } from "@/lib/arca/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET: prueba de conectividad — heartbeat + lista de PtoVta y TipoCbte habilitados. */
export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { supabase, userId } = auth;

  try {
    const dummy = await feDummy();
    const { cuit } = getCredentials();
    const ticket = await getAccessTicket(supabase, userId, "wsfe");
    const ptosVenta = await feParamGetPtosVenta(ticket, cuit);
    const tiposCbte = await feParamGetTiposCbte(ticket, cuit);

    return NextResponse.json({
      ok: true,
      via: auth.via,
      ambiente: ARCA_ENV,
      cuit,
      heartbeat: dummy,
      ticketExpiraAt: ticket.expiraAt,
      ptosVenta,
      tiposCbte,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
