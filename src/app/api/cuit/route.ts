import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cuit?cuit=20123456789
 * Busca razón social en cuitonline.com (padrón ARCA/AFIP público).
 */
export async function GET(req: NextRequest) {
  const cuit = req.nextUrl.searchParams.get("cuit")?.replace(/\D/g, "");
  if (!cuit || cuit.length < 10) {
    return NextResponse.json({ error: "CUIT inválido" }, { status: 400 });
  }

  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

  // ── Intento 1: cuitonline.com ─────────────────────────────────────────────
  try {
    const res = await fetch(`https://www.cuitonline.com/${cuit}`, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const html = await res.text();
      // El <title> suele ser: "20123456789 - GARCIA JUAN | CUIT Online"
      // O hay un <h1> con la razón social
      const fromTitle = html.match(
        /<title>\s*[\d-]+\s*[-–]\s*([^|<\n]+)/i
      )?.[1]?.trim();
      const fromH1 = html.match(/<h1[^>]*>\s*([^<]{3,})\s*<\/h1>/i)?.[1]?.trim();
      const razon = fromTitle || fromH1;
      if (razon && razon.length > 2) {
        return NextResponse.json({ razon_social: razon });
      }
    }
  } catch {
    // continuar
  }

  // ── Intento 2: cuitonline búsqueda por CUIT ───────────────────────────────
  try {
    const res = await fetch(
      `https://www.cuitonline.com/search.php?q=${cuit}`,
      {
        headers: { "User-Agent": UA, Accept: "text/html" },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (res.ok) {
      const html = await res.text();
      // Buscar el nombre en la página de resultados
      const match = html.match(
        /class=["']?nombre["']?[^>]*>\s*([^<]{3,})\s*</i
      );
      const razon = match?.[1]?.trim();
      if (razon && razon.length > 2) {
        return NextResponse.json({ razon_social: razon });
      }
    }
  } catch {
    // continuar
  }

  // ── Intento 3: TangoFactura (parsear body incluso en errores) ─────────────
  try {
    const res = await fetch(
      `https://afip.tangofactura.com/Rest/GetContribuyenteByCuit?Cuit=${cuit}`,
      {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      }
    );
    const data = await res.json().catch(() => null);
    if (data) {
      const c =
        (data?.Contribuyente ?? data?.contribuyente) as Record<string, unknown> | null;
      const razon =
        (c?.RazonSocial as string) ||
        (c?.Apellido
          ? `${c.Apellido}${c.Nombre ? " " + c.Nombre : ""}`.trim()
          : null);
      if (razon) return NextResponse.json({ razon_social: razon });
    }
  } catch {
    // todos fallaron
  }

  return NextResponse.json(
    { error: "No se encontró información para ese CUIT." },
    { status: 404 }
  );
}
