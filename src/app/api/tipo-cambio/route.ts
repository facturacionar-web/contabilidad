import { NextRequest, NextResponse } from "next/server";
import { SignJWT, importPKCS8 } from "jose";

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const TC_SHEET_NAME = "_TC_Lookup";

// ── Auth (mismo flow que sync-factura) ────────────────────────────────────────
async function getAccessToken(): Promise<string> {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("GOOGLE_SERVICE_ACCOUNT_B64 no configurado");
  const creds = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  const privateKey = await importPKCS8(creds.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/spreadsheets" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(creds.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Token error ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token as string;
}

async function sheetsFetch(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

type SheetMeta = { locale: string; needsSemicolons: boolean };

async function ensureTcSheet(token: string): Promise<SheetMeta> {
  const meta = await sheetsFetch(token, "");
  const found = (meta.sheets ?? []).find(
    (s: { properties?: { title?: string } }) => s.properties?.title === TC_SHEET_NAME
  );
  if (!found) {
    await sheetsFetch(token, ":batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        requests: [{
          addSheet: {
            properties: {
              title: TC_SHEET_NAME,
              hidden: true,
              gridProperties: { rowCount: 50, columnCount: 5 },
            },
          },
        }],
      }),
    });
  }
  const locale: string = meta?.properties?.locale ?? "en_US";
  // Locales que usan coma como decimal y por ende ; como separador de argumentos
  const needsSemicolons = /^(es|de|fr|it|pt|nl|pl|ru|tr|el|cs|fi|sv|da|nb|hu|ro|uk|bg|hr|sk|sl|et|lv|lt|ca|gl|eu)/i.test(locale);
  return { locale, needsSemicolons };
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, "0");
  const nd = String(dt.getDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}

/** Limpia la hoja de TC antes de escribir, así no quedan valores viejos */
async function clearTcSheet(token: string): Promise<void> {
  await sheetsFetch(
    token,
    `/values/${encodeURIComponent(TC_SHEET_NAME)}!A1:Z50:clear`,
    { method: "POST", body: "{}" }
  );
}

// ── Handler ────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const moneda = (params.get("moneda") ?? "USD").toUpperCase();
    const fecha = params.get("fecha") ?? todayISO();
    const base = (params.get("base") ?? "ARS").toUpperCase();
    const debug = params.get("debug") === "1";

    if (moneda === base) {
      return NextResponse.json({ ok: true, valor: 1, fecha, fuente: "Misma moneda" });
    }
    if (!/^[A-Z]{3}$/.test(moneda) || !/^[A-Z]{3}$/.test(base)) {
      return NextResponse.json({ ok: false, error: "Moneda inválida" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return NextResponse.json({ ok: false, error: "Fecha inválida" }, { status: 400 });
    }

    const today = todayISO();
    const ticker = `${moneda}${base}`;
    const isHistorical = fecha < today;

    const token = await getAccessToken();
    const sheetMeta = await ensureTcSheet(token);
    await clearTcSheet(token);

    // Separador de argumentos según el locale del spreadsheet
    const sep = sheetMeta.needsSemicolons ? ";" : ",";

    let formula: string;
    if (!isHistorical) {
      formula = `=GOOGLEFINANCE("CURRENCY:${ticker}")`;
    } else {
      // Histórico: damos un rango de 14 días desde la fecha pedida.
      // GOOGLEFINANCE devuelve un array que se "spillea" en celdas adyacentes:
      //   A1: "Date"   B1: "Close"
      //   A2: fecha1   B2: valor1
      //   A3: fecha2   B3: valor2  ...
      const [y, m, d] = fecha.split("-").map(Number);
      // Calculamos end_date en JS para evitar aritmética DATE()+N que el parser
      // rechaza en algunos locales.
      const endDt = new Date(y, m - 1, d);
      endDt.setDate(endDt.getDate() + 14);
      const ey = endDt.getFullYear();
      const em = endDt.getMonth() + 1;
      const ed = endDt.getDate();
      const startD = `DATE(${y}${sep}${m}${sep}${d})`;
      const endD = `DATE(${ey}${sep}${em}${sep}${ed})`;
      formula = `=GOOGLEFINANCE("CURRENCY:${ticker}"${sep}"price"${sep}${startD}${sep}${endD})`;
    }

    // Escribir fórmula en A1 — para histórico, dejamos que spillee a B1, A2, B2, etc.
    await sheetsFetch(
      token,
      `/values/${encodeURIComponent(TC_SHEET_NAME)}!A1?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        body: JSON.stringify({ values: [[formula]] }),
      }
    );

    // Leer rango con reintentos (la fórmula puede tardar varios segundos)
    let valor: number | null = null;
    let lastValues: unknown[][] = [];
    let foundLoading = false;

    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((r) => setTimeout(r, attempt === 0 ? 500 : 800));

      // Para hoy, solo necesitamos A1; para histórico, leer todo el rango spilled
      const range = isHistorical ? "A1:B20" : "A1";
      const data = await sheetsFetch(
        token,
        `/values/${encodeURIComponent(TC_SHEET_NAME)}!${range}?valueRenderOption=UNFORMATTED_VALUE`
      );
      const rows: unknown[][] = data.values ?? [];
      lastValues = rows;

      if (!isHistorical) {
        const cell = rows[0]?.[0];
        if (typeof cell === "number" && cell > 0) { valor = cell; break; }
        if (typeof cell === "string" && cell.includes("Loading")) { foundLoading = true; continue; }
        if (typeof cell === "string" && cell !== "") {
          return NextResponse.json(
            { ok: false, error: `Google Finance: ${cell}`, raw: rows },
            { status: 502 }
          );
        }
        continue;
      }

      // Histórico: buscar la primera fila con número en columna B (después de la fila de headers)
      // rows[0] = ["Date", "Close"]
      // rows[1..n] = [fechaCell, valorCell]
      let stillLoading = false;
      for (let i = 1; i < rows.length; i++) {
        const v = rows[i]?.[1];
        if (typeof v === "number" && v > 0) {
          valor = v;
          break;
        }
        if (typeof v === "string" && v.includes("Loading")) {
          stillLoading = true;
        }
      }
      if (valor != null) break;
      if (stillLoading || rows.length <= 1) {
        foundLoading = stillLoading;
        continue;
      }
      // Si la primer fila tiene un error explícito
      const headerCell = rows[0]?.[0];
      if (typeof headerCell === "string" && headerCell !== "Date" && headerCell !== "") {
        return NextResponse.json(
          {
            ok: false,
            error: `Google Finance devolvió: ${headerCell}`,
            raw: debug ? rows : undefined,
          },
          { status: 502 }
        );
      }
    }

    if (valor == null) {
      return NextResponse.json(
        {
          ok: false,
          error: foundLoading
            ? "Google Finance está tardando más de lo normal. Probá de nuevo."
            : `Google Finance no devolvió datos para ${moneda}/${base} en ${fecha}.`,
          raw: debug ? lastValues : undefined,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      valor: Math.round(valor * 100) / 100,
      fecha,
      fuente: "Google Finance",
      ...(debug ? { raw: lastValues } : {}),
    });
  } catch (err) {
    console.error("[tipo-cambio] error:", String(err));
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
