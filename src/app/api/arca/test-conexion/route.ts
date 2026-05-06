import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccessTicket } from "@/lib/arca/wsaa";
import { feDummy, feParamGetPtosVenta, feParamGetTiposCbte } from "@/lib/arca/wsfev1";
import { getCredentials, ARCA_ENV } from "@/lib/arca/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET: prueba de conectividad — heartbeat + lista de PtoVta y TipoCbte habilitados. */
export async function GET() {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;
  if (!user) {
    return NextResponse.json({ ok: false, error: "no autenticado" }, { status: 401 });
  }

  try {
    const dummy = await feDummy();
    const { cuit } = getCredentials();
    const ticket = await getAccessTicket(supabase, user.id, "wsfe");
    const ptosVenta = await feParamGetPtosVenta(ticket, cuit);
    const tiposCbte = await feParamGetTiposCbte(ticket, cuit);

    return NextResponse.json({
      ok: true,
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
