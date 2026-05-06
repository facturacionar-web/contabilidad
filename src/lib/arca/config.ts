export type ArcaEnv = "produccion" | "homologacion";

export const ARCA_ENV: ArcaEnv =
  (process.env.ARCA_ENV as ArcaEnv) === "homologacion" ? "homologacion" : "produccion";

export const URLS = {
  produccion: {
    wsaa:   "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfev1: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
  homologacion: {
    wsaa:   "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfev1: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
} as const;

export function getCredentials() {
  const cuit = process.env.ARCA_CUIT;
  const certPem = process.env.ARCA_CERT_PEM;
  const keyPem = process.env.ARCA_KEY_PEM;
  if (!cuit || !certPem || !keyPem) {
    throw new Error(
      "Faltan env vars: ARCA_CUIT, ARCA_CERT_PEM, ARCA_KEY_PEM"
    );
  }
  return { cuit, certPem, keyPem };
}
