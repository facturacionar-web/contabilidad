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

export function formatDate(date: string | Date, locale = "es-MX"): string {
  const d =
    typeof date === "string"
      ? /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? new Date(date + "T00:00:00")
        : new Date(date)
      : date;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
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

export function monthRange(isoDate: string): { start: string; end: string } {
  const [y, m] = isoDate.split("-").map(Number);
  const start = toISO(new Date(y, m - 1, 1));
  const end = toISO(new Date(y, m, 0));
  return { start, end };
}
