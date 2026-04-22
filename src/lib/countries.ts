export type CountryCode = "MX" | "AR" | "CL";
export type CurrencyCode = "MXN" | "ARS" | "CLP" | "USD" | "EUR";

export interface Country {
  code: CountryCode;
  name: string;
  flag: string;
  currency: CurrencyCode;
  ivaRates: number[];
  ivaDefault: number;
  taxIdLabel: string;
  taxIdPlaceholder: string;
  locale: string;
}

export const COUNTRIES: Record<CountryCode, Country> = {
  MX: {
    code: "MX",
    name: "México",
    flag: "🇲🇽",
    currency: "MXN",
    ivaRates: [0, 8, 16],
    ivaDefault: 16,
    taxIdLabel: "RFC",
    taxIdPlaceholder: "XAXX010101000",
    locale: "es-MX",
  },
  AR: {
    code: "AR",
    name: "Argentina",
    flag: "🇦🇷",
    currency: "ARS",
    ivaRates: [0, 10.5, 21, 27],
    ivaDefault: 21,
    taxIdLabel: "CUIT",
    taxIdPlaceholder: "20-12345678-9",
    locale: "es-AR",
  },
  CL: {
    code: "CL",
    name: "Chile",
    flag: "🇨🇱",
    currency: "CLP",
    ivaRates: [0, 19],
    ivaDefault: 19,
    taxIdLabel: "RUT",
    taxIdPlaceholder: "12.345.678-9",
    locale: "es-CL",
  },
};

export interface Currency {
  code: CurrencyCode;
  name: string;
  symbol: string;
  decimals: number;
}

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  MXN: { code: "MXN", name: "Peso mexicano", symbol: "$", decimals: 2 },
  ARS: { code: "ARS", name: "Peso argentino", symbol: "$", decimals: 2 },
  CLP: { code: "CLP", name: "Peso chileno", symbol: "$", decimals: 0 },
  USD: { code: "USD", name: "Dólar estadounidense", symbol: "US$", decimals: 2 },
  EUR: { code: "EUR", name: "Euro", symbol: "€", decimals: 2 },
};

export const PAYMENT_METHODS = [
  "Efectivo",
  "Transferencia",
  "Tarjeta débito",
  "Tarjeta crédito",
  "Cheque",
  "Otro",
] as const;

export const INCOME_CATEGORIES = [
  "Venta de servicios",
  "Venta de productos",
  "Préstamo recibido",
  "Devolución",
  "Intereses",
  "Otros ingresos",
] as const;

export const EXPENSE_CATEGORIES = [
  "Compras",
  "Servicios",
  "Arriendo / Alquiler",
  "Servicios públicos",
  "Sueldos",
  "Honorarios",
  "Impuestos",
  "Transporte",
  "Publicidad",
  "Mantenimiento",
  "Otros gastos",
] as const;
