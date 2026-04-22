import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cuit?cuit=20123456789
 * Proxy hacia la API pública de AFIP (TangoFactura) para buscar razón social por CUIT.
 */
export async function GET(req: NextRequest) {
  const cuit = req.nextUrl.searchParams.get("cuit")?.replace(/\D/g, "");
  if (!cuit || cuit.length < 10) {
    return NextResponse.json({ error: "CUIT inválido" }, { status: 400 });
  }

  try {
    const url = `https://afip.tangofactura.com/Rest/GetContribuyenteByCuit?Cuit=${cuit}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      // 8 second timeout
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    const data = await res.json();

    // La API devuelve { Contribuyente: { RazonSocial: "...", ... } }
    const razon =
      data?.Contribuyente?.RazonSocial ??
      data?.contribuyente?.razonSocial ??
      data?.razonSocial ??
      null;

    if (!razon) {
      return NextResponse.json({ error: "CUIT no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ razon_social: razon });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
