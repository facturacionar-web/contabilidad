/**
 * Parser del CSV de release_report de MP.
 *
 * Formato:
 *   - Separador: ;
 *   - Encoding: UTF-8
 *   - Comillas: campos con `;` van entre `"`. Algunos campos JSON-like vienen
 *     con escapado raro (comillas dobles dentro de comillas, sin escapar).
 *   - 42 columnas, header en la fila 1.
 *
 * Implementamos un parser minimalista que solo respeta las comillas y el
 * separador. No parseamos los campos JSON-like (METADATA, TAXES_DISAGGREGATED,
 * OPERATION_TAGS) — los guardamos como string en `raw`.
 */

export type ReleaseRow = {
  DATE: string;
  SOURCE_ID: string;
  EXTERNAL_REFERENCE: string;
  RECORD_TYPE: string;
  DESCRIPTION: string;
  NET_CREDIT_AMOUNT: string;
  NET_DEBIT_AMOUNT: string;
  GROSS_AMOUNT: string;
  SELLER_AMOUNT: string;
  MP_FEE_AMOUNT: string;
  FINANCING_FEE_AMOUNT: string;
  SHIPPING_FEE_AMOUNT: string;
  TAXES_AMOUNT: string;
  COUPON_AMOUNT: string;
  INSTALLMENTS: string;
  PAYMENT_METHOD: string;
  TRANSACTION_APPROVAL_DATE: string;
  ORDER_ID: string;
  SHIPPING_ID: string;
  BALANCE_AMOUNT: string;
  PAYOUT_BANK_ACCOUNT_NUMBER: string;
  [k: string]: string;
};

/** Parseo línea por línea con manejo de comillas. */
function splitCsvLine(line: string, sep = ";"): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // doble comilla escapada
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseReleaseCsv(csv: string): ReleaseRow[] {
  // strip BOM
  const text = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];

  const headers = splitCsvLine(lines[0]);
  const rows: ReleaseRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cells = splitCsvLine(line);
    const row: ReleaseRow = {} as ReleaseRow;
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

/** Parsea un campo numérico del CSV; soporta `1.234,56` y `1234.56`. */
export function parseAmount(s: string | undefined | null): number {
  if (!s) return 0;
  const cleaned = s.trim();
  if (cleaned === "" || cleaned === "-") return 0;
  // Si tiene coma como decimal y punto como miles → 1.234,56
  if (/,\d{1,2}$/.test(cleaned) && cleaned.includes(".")) {
    return Number(cleaned.replace(/\./g, "").replace(",", "."));
  }
  if (/,\d{1,2}$/.test(cleaned)) {
    return Number(cleaned.replace(",", "."));
  }
  return Number(cleaned);
}
