import { NextRequest, NextResponse } from "next/server";
import { SignJWT, importPKCS8 } from "jose";

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const SHEET_NAME = "Gastos";

// ── Auth ──────────────────────────────────────────────────────────────────────
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

// ── Sheets helpers ────────────────────────────────────────────────────────────
async function sheetsGet(token: string, path: string) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}
async function sheetsPost(token: string, path: string, body: unknown) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}
async function sheetsPut(token: string, path: string, body: unknown) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Distribution types (mirrors proveedoresConfig.ts, no localStorage) ────────
type DistCuentas = { dropshipping: number; importado_stock: number; importado_nacional: number };
type ConceptoCfg = {
  operativo: boolean;
  incluir: boolean;
  dist_pais: { ARG: number; MEX: number; CHILE: number };
  dist_cuentas: { ARG: DistCuentas; MEX: DistCuentas; CHILE: DistCuentas };
  prorrateo: { ARG: boolean; MEX: boolean; CHILE: boolean };
};
function emptyDC(): DistCuentas { return { dropshipping: 0, importado_stock: 0, importado_nacional: 0 }; }
function emptyCfg(): ConceptoCfg {
  return {
    operativo: true, incluir: true,
    dist_pais: { ARG: 0, MEX: 0, CHILE: 0 },
    dist_cuentas: { ARG: emptyDC(), MEX: emptyDC(), CHILE: emptyDC() },
    prorrateo: { ARG: false, MEX: false, CHILE: false },
  };
}

// ── Schema: 14 base + 17 distribución = 31 columnas ──────────────────────────
const HEADER = [
  // Base (14)
  "ID", "Tipo", "Fecha emisión", "Fecha vencimiento",
  "Concepto", "Proveedor", "Moneda",
  "Subtotal", "IVA", "Monto", "Monto en pesos",
  "Tipo de cambio", "Estado", "Notas",
  // Distribución (17)
  "Operativo", "Incluir",
  "ARG monto", "MEX monto", "CHILE monto",
  "ARG DropShipping", "ARG Importado Stock", "ARG Importado Nacional", "ARG Prorrateo",
  "MEX DropShipping", "MEX Importado Stock", "MEX Importado Nacional", "MEX Prorrateo",
  "CHILE DropShipping", "CHILE Importado Stock", "CHILE Importado Nacional", "CHILE Prorrateo",
];

/** Convierte índice 0-based a letra de columna: 0→A, 25→Z, 26→AA, 30→AE */
function colLetter(i: number): string {
  if (i < 26) return String.fromCharCode(65 + i);
  return String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}
const LAST_COL = colLetter(HEADER.length - 1); // "AE"

// ── Distribution columns ──────────────────────────────────────────────────────
/**
 * Devuelve 17 valores para las columnas de distribución.
 * concepto: nombre del concepto (key en distConfigs)
 * montoEnPesos: monto ya convertido a pesos ARS
 */
function distCols(
  concepto: string,
  montoEnPesos: number,
  distConfigs: Record<string, ConceptoCfg>,
): unknown[] {
  const raw = distConfigs[concepto];
  const base = emptyCfg();
  const cfg: ConceptoCfg = raw ? {
    operativo: raw.operativo ?? base.operativo,
    incluir:   raw.incluir   ?? base.incluir,
    dist_pais: { ...base.dist_pais,   ...raw.dist_pais },
    dist_cuentas: {
      ARG:   { ...emptyDC(), ...raw.dist_cuentas?.ARG },
      MEX:   { ...emptyDC(), ...raw.dist_cuentas?.MEX },
      CHILE: { ...emptyDC(), ...raw.dist_cuentas?.CHILE },
    },
    prorrateo: { ...base.prorrateo, ...raw.prorrateo },
  } : base;

  const dp = cfg.dist_pais;
  const dc = cfg.dist_cuentas;
  const pr = cfg.prorrateo;

  const argM   = montoEnPesos * dp.ARG   / 100;
  const mexM   = montoEnPesos * dp.MEX   / 100;
  const chileM = montoEnPesos * dp.CHILE / 100;

  const round2 = (n: number) => Math.round(n * 100) / 100;

  return [
    cfg.operativo ? "Sí" : "No",
    cfg.incluir   ? "Sí" : "No",
    round2(argM), round2(mexM), round2(chileM),
    round2(argM   * dc.ARG.dropshipping     / 100),
    round2(argM   * dc.ARG.importado_stock  / 100),
    round2(argM   * dc.ARG.importado_nacional / 100),
    pr.ARG   ? "Sí" : "No",
    round2(mexM   * dc.MEX.dropshipping     / 100),
    round2(mexM   * dc.MEX.importado_stock  / 100),
    round2(mexM   * dc.MEX.importado_nacional / 100),
    pr.MEX   ? "Sí" : "No",
    round2(chileM * dc.CHILE.dropshipping   / 100),
    round2(chileM * dc.CHILE.importado_stock / 100),
    round2(chileM * dc.CHILE.importado_nacional / 100),
    pr.CHILE ? "Sí" : "No",
  ];
}

type Item = {
  concepto_nombre?: string;
  neto?: number;
  iva_monto?: number;
  total?: number;
};

// ── Row builders ──────────────────────────────────────────────────────────────

/** Una fila por ítem de la factura */
function buildFacturaRows(b: Record<string, unknown>): unknown[][] {
  const tasa = Number(b.tasa_cambio ?? 1);
  const items = (Array.isArray(b.items) ? b.items : []) as Item[];
  const distConfigs = (b.dist_configs ?? {}) as Record<string, ConceptoCfg>;

  if (items.length === 0) {
    const monto = Number(b.total ?? 0);
    const montoARS = monto * tasa;
    return [[
      `F${b.id}_0`,
      "Factura",
      b.fecha ?? "",
      b.fecha_vencimiento ?? "",
      b.concepto ?? "",
      b.proveedor ?? "",
      b.moneda ?? "",
      Number(b.subtotal ?? 0),
      Number(b.iva_monto ?? 0),
      monto,
      montoARS,
      tasa,
      b.estado ?? "pendiente",
      b.notas ?? "",
      ...distCols(String(b.concepto ?? ""), montoARS, distConfigs),
    ]];
  }

  return items.map((item, n) => {
    const monto    = Number(item.total ?? item.neto ?? 0);
    const neto     = Number(item.neto  ?? monto);
    const iva      = Number(item.iva_monto ?? 0);
    const montoARS = monto * tasa;
    return [
      `F${b.id}_${n}`,
      "Factura",
      b.fecha ?? "",
      b.fecha_vencimiento ?? "",
      item.concepto_nombre ?? "",
      b.proveedor ?? "",
      b.moneda ?? "",
      neto,
      iva,
      monto,
      montoARS,
      tasa,
      b.estado ?? "pendiente",
      b.notas ?? "",
      ...distCols(item.concepto_nombre ?? "", montoARS, distConfigs),
    ];
  });
}

/** Una fila por línea directa del pago */
function buildPagoRows(b: Record<string, unknown>): unknown[][] {
  const tasa = Number(b.tasa_cambio ?? 1);
  const items = (Array.isArray(b.items) ? b.items : []) as Item[];
  const distConfigs = (b.dist_configs ?? {}) as Record<string, ConceptoCfg>;
  if (items.length === 0) return [];

  return items.map((item, n) => {
    const monto    = Number(item.total ?? item.neto ?? 0);
    const neto     = Number(item.neto  ?? monto);
    const iva      = Number(item.iva_monto ?? 0);
    const montoARS = monto * tasa;
    return [
      `P${b.id}_${n}`,
      "Pago sin factura",
      b.fecha ?? "",
      "",
      item.concepto_nombre ?? "",
      b.proveedor ?? "",
      b.moneda ?? "",
      neto,
      iva,
      monto,
      montoARS,
      tasa,
      "pagado",
      b.notas ?? "",
      ...distCols(item.concepto_nombre ?? "", montoARS, distConfigs),
    ];
  });
}

// ── Ensure sheet ──────────────────────────────────────────────────────────────
async function ensureSheet(token: string): Promise<number> {
  const meta = await sheetsGet(token, "");
  const found = (meta.sheets ?? []).find(
    (s: { properties?: { title?: string; sheetId?: number } }) =>
      s.properties?.title === SHEET_NAME
  );

  let sheetId: number;
  if (found) {
    sheetId = found.properties.sheetId as number;
  } else {
    const res = await sheetsPost(token, ":batchUpdate", {
      requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
    });
    sheetId = res.replies?.[0]?.addSheet?.properties?.sheetId as number;
  }

  // Siempre actualiza la fila de encabezado (agrega columnas nuevas si el schema creció)
  await sheetsPut(
    token,
    `/values/${SHEET_NAME}!A1:${LAST_COL}1?valueInputOption=USER_ENTERED`,
    { values: [HEADER] },
  );

  return sheetId;
}

// Obtiene columna A completa
async function getAllIds(token: string): Promise<string[]> {
  const data = await sheetsGet(token, `/values/${SHEET_NAME}!A:A`);
  return ((data.values ?? []) as string[][]).map(r => r[0] ?? "");
}

// Encuentra filas (1-based) cuyo ID empieza con el prefijo
function findRowsByPrefix(ids: string[], prefix: string): number[] {
  const rows: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (ids[i].startsWith(prefix)) rows.push(i + 1);
  }
  return rows;
}

// Elimina filas en orden descendente para no correr índices
async function deleteRows(token: string, sheetId: number, rows: number[]) {
  if (rows.length === 0) return;
  const sorted = [...rows].sort((a, b) => b - a);
  const requests = sorted.map(row => ({
    deleteDimension: {
      range: { sheetId, dimension: "ROWS", startIndex: row - 1, endIndex: row },
    },
  }));
  await sheetsPost(token, ":batchUpdate", { requests });
}

// Sync genérico: borra filas existentes con el prefijo e inserta las nuevas
async function syncRows(
  token: string,
  sheetId: number,
  prefix: string,
  newRows: unknown[][]
) {
  const ids = await getAllIds(token);
  const existing = findRowsByPrefix(ids, prefix);
  await deleteRows(token, sheetId, existing);
  if (newRows.length > 0) {
    await sheetsPost(token, `/values/${SHEET_NAME}!A1:append?valueInputOption=USER_ENTERED`, {
      values: newRows,
    });
  }
}

// ── POST: crear ───────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const tipo: string = (body.tipo_sync as string) ?? "factura";
    console.log(`[sync] POST ${tipo} id:`, body.id);

    const token = await getAccessToken();
    await ensureSheet(token);

    const rows = tipo === "pago" ? buildPagoRows(body) : buildFacturaRows(body);
    if (rows.length === 0) return NextResponse.json({ ok: true, skipped: true });

    await sheetsPost(token, `/values/${SHEET_NAME}!A1:append?valueInputOption=USER_ENTERED`, {
      values: rows,
    });

    console.log(`[sync] POST OK, ${rows.length} fila(s)`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[sync] POST ERROR:", String(err));
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

// ── PATCH: editar ─────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const tipo: string = (body.tipo_sync as string) ?? "factura";
    console.log(`[sync] PATCH ${tipo} id:`, body.id);

    const token = await getAccessToken();
    const sheetId = await ensureSheet(token);
    const prefix = tipo === "pago" ? `P${body.id}_` : `F${body.id}_`;
    const rows = tipo === "pago" ? buildPagoRows(body) : buildFacturaRows(body);

    await syncRows(token, sheetId, prefix, rows);

    console.log(`[sync] PATCH OK, ${rows.length} fila(s)`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[sync] PATCH ERROR:", String(err));
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

// ── DELETE: eliminar ──────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const { id, tipo_sync } = await req.json() as { id: number; tipo_sync?: string };
    const tipo = tipo_sync ?? "factura";
    console.log(`[sync] DELETE ${tipo} id:`, id);

    const token = await getAccessToken();
    const sheetId = await ensureSheet(token);
    const prefix = tipo === "pago" ? `P${id}_` : `F${id}_`;
    const ids = await getAllIds(token);
    const rows = findRowsByPrefix(ids, prefix);
    await deleteRows(token, sheetId, rows);

    console.log(`[sync] DELETE OK, ${rows.length} fila(s) eliminadas`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[sync] DELETE ERROR:", String(err));
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
