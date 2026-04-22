import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cuit?cuit=20123456789
 * Busca razón social en AFIP (vía TangoFactura) por CUIT.
 */
export async function GET(req: NextRequest) {
  const cuit = req.nextUrl.searchParams.get("cuit")?.replace(/\D/g, "");
  if (!cuit || cuit.length < 10) {
    return NextResponse.json({ error: "CUIT inválido" }, { status: 400 });
  }

  try {
    const url = `https://afip.tangofactura.com/Rest/GetContribuyenteByCuit?Cuit=${cuit}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `API respondió ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();

    const c = data?.Contribuyente ?? data?.contribuyente;

    if (!c) {
      return NextResponse.json(
        { error: "CUIT no encontrado" },
        { status: 404 }
      );
    }

    // Personas jurídicas: RazonSocial
    // Personas físicas: Apellido + Nombre
    const razon =
      c.RazonSocial ||
      c.razonSocial ||
      (c.Apellido
        ? `${c.Apellido}${c.Nombre ? ", " + c.Nombre : ""}`.trim()
        : null) ||
      (c.apellido
        ? `${c.apellido}${c.nombre ? ", " + c.nombre : ""}`.trim()
        : null);

    if (!razon) {
      return NextResponse.json(
        { error: "Sin denominación", raw: c },
        { status: 404 }
      );
    }

    return NextResponse.json({ razon_social: razon });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
