import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/arca/auth";
import { authenticateToPortal } from "@/lib/sii/auth";
import { getResumenVentas } from "@/lib/sii/rcv";
import { getCredentials, SII_ENV } from "@/lib/sii/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET: heartbeat — autentica con el cert y trae el resumen del mes actual. */
export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  try {
    const { rut } = getCredentials();
    const client = await authenticateToPortal();

    const ahora = new Date();
    const periodo = `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, "0")}`;

    try {
      const resp = await getResumenVentas(client, rut, periodo);
      return NextResponse.json({
        ok: true,
        via: auth.via,
        ambiente: SII_ENV,
        rut,
        periodoTest: periodo,
        cookiesActivas: [...client.cookies.keys()],
        respEstado: resp.respEstado,
        totalDocsResumen: resp.totDocRes,
        tiposEncontrados: (resp.data ?? []).map((d) => ({
          codigo: d.rsmnTipoDocInteger,
          nombre: d.dcvNombreTipoDoc,
          cantidad: d.rsmnTotDoc,
          total: d.rsmnMntTotal,
        })),
      });
    } finally {
      await client.dispatcher.close().catch(() => {});
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
