/**
 * Cliente del endpoint /api/tipo-cambio que usa GOOGLEFINANCE vía Sheets.
 */

import type { CurrencyCode } from "./countries";

export type TipoCambioResult = {
  valor: number;
  fecha: string;
  fuente: string;
};

export async function fetchTipoCambio(
  moneda: CurrencyCode,
  fechaISO: string,
  base: CurrencyCode = "ARS",
): Promise<TipoCambioResult | null> {
  if (moneda === base) return { valor: 1, fecha: fechaISO, fuente: "Misma moneda" };

  try {
    const url = `/api/tipo-cambio?moneda=${moneda}&fecha=${fechaISO}&base=${base}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      console.warn("[tipoCambio]", data?.error ?? `HTTP ${res.status}`);
      return null;
    }
    return { valor: Number(data.valor), fecha: data.fecha, fuente: data.fuente };
  } catch (e) {
    console.error("[tipoCambio] network error:", e);
    return null;
  }
}
