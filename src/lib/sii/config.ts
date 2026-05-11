export type SiiEnv = "produccion" | "certificacion";

export const SII_ENV: SiiEnv =
  (process.env.SII_AMBIENTE as SiiEnv) === "certificacion"
    ? "certificacion"
    : "produccion";

export const URLS = {
  produccion: {
    portal: "https://www4.sii.cl/consdcvinternetui/",
    rcvFacade: "https://www4.sii.cl/consdcvinternetui/services/data/facadeService",
    auth: "https://herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi",
  },
  certificacion: {
    portal: "https://www4c.sii.cl/consdcvinternetui/",
    rcvFacade: "https://www4c.sii.cl/consdcvinternetui/services/data/facadeService",
    auth: "https://maullin.sii.cl/cgi_AUT2000/CAutInicio.cgi",
  },
} as const;

export function getCredentials() {
  const rut = process.env.SII_RUT_EMPRESA;
  const certPem = process.env.SII_CERT_PEM;
  const keyPem = process.env.SII_KEY_PEM;
  if (!rut || !certPem || !keyPem) {
    throw new Error(
      "Faltan env vars: SII_RUT_EMPRESA, SII_CERT_PEM, SII_KEY_PEM",
    );
  }
  return { rut, certPem, keyPem };
}

export function splitRut(rut: string): { num: number; dv: string } {
  const clean = rut.replace(/\./g, "").replace(/-/g, "").toUpperCase();
  return { num: Number(clean.slice(0, -1)), dv: clean.slice(-1) };
}

// Códigos de tipo de DTE en el RCV chileno
export const DTE_TIPOS = {
  FACTURA: 33,
  FACTURA_EXENTA: 34,
  BOLETA: 39,
  BOLETA_EXENTA: 41,
  LIQUIDACION_FACTURA: 43,
  FACTURA_COMPRA: 46,
  GUIA_DESPACHO: 52,
  NOTA_DEBITO: 56,
  NOTA_CREDITO: 61,
  FACTURA_EXPORTACION: 110,
} as const;

export const DTE_LABELS: Record<number, string> = {
  33: "Factura Electrónica",
  34: "Factura Exenta Electrónica",
  39: "Boleta Electrónica",
  41: "Boleta Exenta Electrónica",
  43: "Liquidación-Factura Electrónica",
  46: "Factura de Compra Electrónica",
  52: "Guía de Despacho Electrónica",
  56: "Nota de Débito Electrónica",
  61: "Nota de Crédito Electrónica",
  110: "Factura de Exportación Electrónica",
};
