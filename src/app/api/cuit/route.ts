import { NextRequest, NextResponse } from "next/server";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function solveMathCaptcha(challenge: string): number | null {
  const wordNums: Record<string, number> = {
    cero: 0, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  };
  // Normalize accents (más→mas, cuál→cual, etc.) then lowercase
  let t = challenge.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  for (const [w, v] of Object.entries(wordNums)) {
    t = t.replace(new RegExp(`\\b${w}\\b`, "g"), String(v));
  }
  // "calcule N op M" pattern
  const calc = t.match(/calcule\s+(\d+)\s*([*x+\-])\s*(\d+)/i);
  if (calc) {
    const a = parseInt(calc[1]), b = parseInt(calc[3]), op = calc[2].toLowerCase();
    if (op === "+") return a + b;
    if (op === "-") return a - b;
    if (op === "*" || op === "x") return a * b;
  }
  // "N mas/menos/por M" pattern (also handles "¿Cual es el resultado de N mas M?")
  const arith = t.match(/(\d+)\s*(mas|\+|menos|-|por|\*|x|×)\s*(\d+)/i);
  if (arith) {
    const a = parseInt(arith[1]), b = parseInt(arith[3]), op = arith[2].toLowerCase();
    if (op === "mas" || op === "+") return a + b;
    if (op === "menos" || op === "-") return a - b;
    if (op === "por" || op === "*" || op === "x" || op === "×") return a * b;
  }
  return null;
}

// Merge new Set-Cookie headers into existing cookie map (later values win for same key)
function mergeCookies(existing: Record<string, string>, res: Response): Record<string, string> {
  const setCookies =
    (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
    (res.headers.get("set-cookie") ?? "").split(/,(?=[^;]+=[^;]+)/).filter(Boolean);
  const merged = { ...existing };
  for (const c of setCookies) {
    const pair = c.split(";")[0].trim();
    const eqIdx = pair.indexOf("=");
    if (eqIdx > 0) merged[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
  }
  return merged;
}

function serializeCookies(cookies: Record<string, string>): string {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function lookupCuitOnline(cuit: string): Promise<string | null> {
  const BASE = "https://www.cuitonline.com";
  const homeRes = await fetch(BASE + "/", {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(8000),
  });
  const cookies = mergeCookies({}, homeRes);
  const searchRes = await fetch(`${BASE}/search.php?q=${cuit}`, {
    headers: { "User-Agent": UA, Accept: "text/html", Referer: BASE + "/", Cookie: serializeCookies(cookies) },
    signal: AbortSignal.timeout(10000),
  });
  if (!searchRes.ok) return null;
  const html = await searchRes.text();
  const match = html.match(/title="Ver detalles de ([^"]+)"/i);
  const razon = match?.[1]?.trim();
  return razon && razon.length > 2 ? razon : null;
}

async function lookupAfip(cuit: string): Promise<string | null> {
  const BASE = "https://seti.afip.gob.ar/padron-puc-constancia-internet";
  let cookies: Record<string, string> = {};

  // Step 1: Session + bar value
  const homeRes = await fetch(`${BASE}/jsp/Constancia.jsp`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(10000),
  });
  cookies = mergeCookies(cookies, homeRes);
  const homeHtml = await homeRes.text();
  const barMatch = homeHtml.match(/name="bar" id="bar" value="(\d+)"/);
  const bar = barMatch?.[1] ?? "0";

  // Step 2: Math captcha
  const captchaRes = await fetch(
    `${BASE}/restCaptchaCode?type=maths&systemId=constanciaPadron`,
    {
      headers: { "User-Agent": UA, Referer: `${BASE}/jsp/Constancia.jsp`, Cookie: serializeCookies(cookies) },
      signal: AbortSignal.timeout(8000),
    }
  );
  cookies = mergeCookies(cookies, captchaRes);
  const captchaData = await captchaRes.json() as { challenge?: string; token?: string };
  const answer = solveMathCaptcha(captchaData.challenge ?? "");
  if (answer === null) return null;

  // Step 3: POST with captcha solution
  const inner = JSON.stringify({
    cuit,
    txtSolucion: String(answer),
    txtToken: captchaData.token ?? "",
    systemId: "constanciaPadron",
  });
  const postRes = await fetch(`${BASE}/ConstanciaAction.do?bar=${bar}`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/json; charset=utf-8",
      Referer: `${BASE}/jsp/Constancia.jsp`,
      Cookie: serializeCookies(cookies),
    },
    body: JSON.stringify({ data: inner }),
    signal: AbortSignal.timeout(10000),
  });
  cookies = mergeCookies(cookies, postRes);
  const postData = await postRes.json() as { redirect?: string };
  if (!postData.redirect || postData.redirect.includes("Error")) return null;

  // Step 4: Fetch constancy HTML (session holds the result server-side)
  // redirect can be ./ConstanciaInscripcionBody.jsp (company) or ./ConstanciaOpcionBody.jsp (monotributo)
  const redirect = postData.redirect;
  const jspFile = redirect.includes("Opcion") ? "ConstanciaOpcionBody.jsp" : "ConstanciaInscripcionBody.jsp";
  const constancyRes = await fetch(`${BASE}/jsp/${jspFile}`, {
    headers: { "User-Agent": UA, Referer: `${BASE}/jsp/Constancia.jsp`, Cookie: serializeCookies(cookies) },
    signal: AbortSignal.timeout(8000),
  });
  // Page uses ISO-8859-1 encoding
  const buf = await constancyRes.arrayBuffer();
  const constancyHtml = new TextDecoder("iso-8859-1").decode(buf);

  // Company (ConstanciaInscripcionBody): <B><i><FONT ...>&nbsp;NAME</FONT>
  const inscripcionMatch = constancyHtml.match(/<B><i><FONT[^>]*>&nbsp;([^<]+)<\/FONT>/i);
  if (inscripcionMatch?.[1]?.trim()) return inscripcionMatch[1].trim();

  // Monotributo (ConstanciaOpcionBody): <FONT face="Arial" SIZE="2">APELLIDO NOMBRE</FONT>
  // The name row comes right after the CUIT row — pick the FONT SIZE="2" that has no digits
  const opcionMatches = [...constancyHtml.matchAll(/<FONT face="Arial" SIZE="2">([^<]+)<\/FONT>/gi)];
  for (const m of opcionMatches) {
    const v = m[1].trim();
    if (v.length > 3 && !/\d/.test(v) && !/&|:/.test(v) && v === v.toUpperCase()) return v;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const cuit = req.nextUrl.searchParams.get("cuit")?.replace(/\D/g, "");
  if (!cuit || cuit.length < 10) {
    return NextResponse.json({ error: "CUIT inválido" }, { status: 400 });
  }

  // Try cuitonline.com first (fast, works for companies)
  try {
    const razon = await lookupCuitOnline(cuit);
    if (razon) return NextResponse.json({ razon_social: razon });
  } catch {
    // continue to fallback
  }

  // Fallback: AFIP/ARCA constancia (works for individuals and companies)
  try {
    const razon = await lookupAfip(cuit);
    if (razon) return NextResponse.json({ razon_social: razon });
  } catch (e) {
    console.error("[cuit/afip]", e);
    // continue
  }

  return NextResponse.json(
    { error: "No se encontró información para ese CUIT/CUIL. Verificá en arca.gob.ar" },
    { status: 404 }
  );
}
