import { CURRENCIES, CurrencyCode } from "./countries";

export function formatMoney(amount: number, currency: CurrencyCode, locale = "es-MX"): string {
  const c = CURRENCIES[currency];
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency,
      minimumFractionDigits: c.decimals,
      maximumFractionDigits: c.decimals,
    }).format(amount);
  } catch {
    return `${c.symbol} ${amount.toFixed(c.decimals)}`;
  }
}

export function formatDate(date: string | Date, locale = "es-AR"): string {
  const d =
    typeof date === "string"
      ? /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? new Date(date + "T00:00:00")
        : new Date(date)
      : date;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parsea un string de monto ingresado por el usuario, tolerando coma o punto como decimal y separadores de miles. */
export function parseMonto(val: string): number {
  if (!val) return 0;
  const s = val.trim();
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const dotCount = (s.match(/\./g) || []).length;
  let normalized: string;
  if (lastComma > lastDot) {
    // Formato AR/ES: 1.234.567,89 o 1234567,89
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (dotCount > 1) {
    // Múltiples puntos sin coma → todos son miles: 2.000.000
    normalized = s.replace(/\./g, "");
  } else {
    // Punto único como decimal (EN) o sin separadores: 2000000.99 o 2000000
    normalized = s.replace(/,/g, "");
  }
  return parseFloat(normalized) || 0;
}

export function monthRange(isoDate: string): { start: string; end: string } {
  const [y, m] = isoDate.split("-").map(Number);
  const start = toISO(new Date(y, m - 1, 1));
  const end = toISO(new Date(y, m, 0));
  return { start, end };
}
