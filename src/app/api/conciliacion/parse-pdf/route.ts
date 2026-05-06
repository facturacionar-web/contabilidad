import { NextRequest, NextResponse } from "next/server";

const PROMPT = `Sos un parser de extractos bancarios argentinos. Recibís un PDF (Mercado Pago, Galicia, BBVA, Santander, Macro, Provincia, Nación, etc.) y extraés cada movimiento.

Devolvé EXCLUSIVAMENTE un JSON válido con esta estructura, sin texto adicional, sin markdown, sin backticks:

{
  "banco_detectado": "nombre del banco o billetera",
  "cuenta_detectada": "número o alias de cuenta si aparece",
  "periodo": { "desde": "YYYY-MM-DD", "hasta": "YYYY-MM-DD" },
  "movimientos": [
    {
      "fecha": "YYYY-MM-DD",
      "descripcion": "descripción literal del banco, lo más completa posible",
      "monto": 12345.67,
      "tipo": "credito",
      "referencia": "nro de operación si está, sino null"
    }
  ]
}

Reglas:
- "monto" SIEMPRE positivo (sin signo negativo). El signo lo determina el campo "tipo".
- "tipo": "credito" = entró plata a la cuenta. "debito" = salió plata. Mirá la columna débito/crédito o el contexto.
- Saltá filas que no son movimientos: saldos iniciales/finales, totales, encabezados, paginación.
- Saltá comisiones de mantenimiento solo si aparecen aparte y no están relacionadas con un movimiento.
- Convertí fechas argentinas (dd/mm/yyyy) a ISO (yyyy-mm-dd).
- Si una descripción se corta en varias líneas, juntala.
- No inventes datos. Si no podés leer un campo, ponelo en null.
- Si no encontrás ningún movimiento, devolvé "movimientos": [].`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY no configurada" }, { status: 500 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ ok: false, error: "Falta archivo" }, { status: 400 });
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ ok: false, error: "El archivo debe ser PDF" }, { status: 400 });
    }
    if (file.size > 30 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "PDF demasiado grande (máx 30 MB)" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const base64 = buf.toString("base64");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 16000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: base64 },
              },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[parse-pdf] anthropic error:", text);
      return NextResponse.json(
        { ok: false, error: `Anthropic ${res.status}: ${text.substring(0, 300)}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const text: string = data.content?.[0]?.text ?? "";

    // Extraer JSON
    let parsed: {
      banco_detectado?: string;
      cuenta_detectada?: string;
      periodo?: { desde: string; hasta: string };
      movimientos: Array<{
        fecha: string;
        descripcion: string;
        monto: number;
        tipo: "debito" | "credito";
        referencia: string | null;
      }>;
    };
    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start === -1 || end === -1) throw new Error("No se encontró JSON en la respuesta");
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          error: `No pude parsear la respuesta de Claude: ${e instanceof Error ? e.message : String(e)}`,
          raw: text.substring(0, 1000),
        },
        { status: 502 }
      );
    }

    // Validar
    if (!Array.isArray(parsed.movimientos)) {
      return NextResponse.json(
        { ok: false, error: "Claude no devolvió 'movimientos' como array" },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, ...parsed });
  } catch (err) {
    console.error("[parse-pdf] error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// Permitir uploads de hasta 30 MB
export const maxDuration = 120; // 2 min, parseo de PDFs grandes
