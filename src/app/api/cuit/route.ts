import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cuit?cuit=20123456789
 * Intenta buscar razón social en AFIP probando múltiples endpoints.
 */

const HEADERS = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; ContabilidadApp/1.0)",
};

/** Extrae razón social de la respuesta de TangoFactura */
function fromTangoFactura(data: Record<string, unknown>): string | null {
  const c = (data?.Contribuyente ?? data?.contribuyente) as Record<string, unknown> | null;
  if (!c) return null;
  return (
    (c.RazonSocial as string) ||
    (c.razonSocial as string) ||
    (c.Apellido
      ? `${c.Apellido}${c.Nombre ? ", " + c.Nombre : ""}`.trim()
      : null) ||
    (c.apellido
      ? `${c.apellido}${c.nombre ? ", " + c.nombre : ""}`.trim()
      : null) ||
    null
  );
}

/** Extrae razón social de la respuesta de AFIP serviciosweb */
function fromAfipServicios(data: Record<string, unknown>): string | null {
  const p = (data?.data ?? data?.persona ?? data) as Record<string, unknown> | null;
  if (!p) return null;
  return (
    (p.nombre as string) ||
    (p.denominacion as string) ||
    (p.razonSocial as string) ||
    (p.apellido
      ? `${p.apellido}${p.nombre ? ", " + p.nombre : ""}`.trim()
      : null) ||
    null
  );
}

export async function GET(req: NextRequest) {
  const cuit = req.nextUrl.searchParams.get("cuit")?.replace(/\D/g, "");
  if (!cuit || cuit.length < 10) {
    return NextResponse.json({ error: "CUIT inválido" }, { status: 400 });
  }

  const timeout = AbortSignal.timeout(8000);

  // ── Intento 1: TangoFactura (parsear body incluso en errores) ──────────────
  try {
    const res1 = await fetch(
      `https://afip.tangofactura.com/Rest/GetContribuyenteByCuit?Cuit=${cuit}`,
      { headers: HEADERS, signal: timeout }
    );
    const data1 = await res1.json().catch(() => null);
    if (data1) {
      const razon = fromTangoFactura(data1 as Record<string, unknown>);
      if (razon) return NextResponse.json({ razon_social: razon });
    }
  } catch {
    // continuar con siguiente intento
  }

  // ── Intento 2: AFIP serviciosweb padron v2 ────────────────────────────────
  try {
    const res2 = await fetch(
      `https://serviciosweb.afip.gob.ar/sr-padron/v2/persona/${cuit}`,
      { headers: HEADERS, signal: AbortSignal.timeout(8000) }
    );
    if (res2.ok) {
      const data2 = await res2.json().catch(() => null);
      if (data2) {
        const razon = fromAfipServicios(data2 as Record<string, unknown>);
        if (razon) return NextResponse.json({ razon_social: razon });
      }
    }
  } catch {
    // continuar
  }

  // ── Intento 3: AFIP serviciosweb padron v4 ────────────────────────────────
  try {
    const res3 = await fetch(
      `https://serviciosweb.afip.gob.ar/sr-padron/v4/persona/${cuit}`,
      { headers: HEADERS, signal: AbortSignal.timeout(8000) }
    );
    if (res3.ok) {
      const data3 = await res3.json().catch(() => null);
      if (data3) {
        const razon = fromAfipServicios(data3 as Record<string, unknown>);
        if (razon) return NextResponse.json({ razon_social: razon });
      }
    }
  } catch {
    // todos los intentos fallaron
  }

  return NextResponse.json(
    { error: "CUIT no encontrado. Verificá que sea correcto o ingresá la razón social manualmente." },
    { status: 404 }
  );
}
