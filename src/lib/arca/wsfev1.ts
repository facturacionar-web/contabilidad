import { XMLParser } from "fast-xml-parser";
import { URLS } from "./config";
import type { AccessTicket } from "./wsaa";

const WSFEV1_URL = URLS[
  (process.env.ARCA_ENV as "homologacion" | "produccion") === "homologacion"
    ? "homologacion"
    : "produccion"
].wsfev1;

const NS = "http://ar.gov.afip.dif.FEV1/";

export type Auth = {
  token: string;
  sign: string;
  cuit: string;
};

function authFromTicket(ticket: AccessTicket, cuit: string): Auth {
  return { token: ticket.token, sign: ticket.sign, cuit };
}

function escapeXml(v: string | number): string {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildSoapEnvelope(method: string, innerBody: string, auth: Auth): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:${method}>
      <ar:Auth>
        <ar:Token>${escapeXml(auth.token)}</ar:Token>
        <ar:Sign>${escapeXml(auth.sign)}</ar:Sign>
        <ar:Cuit>${escapeXml(auth.cuit)}</ar:Cuit>
      </ar:Auth>
      ${innerBody}
    </ar:${method}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

async function callSoap(method: string, body: string, auth: Auth): Promise<Record<string, unknown>> {
  const envelope = buildSoapEnvelope(method, body, auth);
  const res = await fetch(WSFEV1_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `${NS}${method}`,
    },
    body: envelope,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WSFEv1 ${method} HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const doc = parser.parse(text) as Record<string, unknown>;
  const envelopeOut = (doc.Envelope ?? {}) as Record<string, unknown>;
  const bodyOut = (envelopeOut.Body ?? {}) as Record<string, unknown>;

  const fault = bodyOut.Fault as { faultstring?: string } | undefined;
  if (fault) {
    throw new Error(`WSFEv1 ${method} fault: ${fault.faultstring ?? JSON.stringify(fault)}`);
  }

  const responseKey = Object.keys(bodyOut).find((k) => k.endsWith("Response"));
  if (!responseKey) {
    throw new Error(`WSFEv1 ${method}: respuesta sin *Response. SOAP: ${text.slice(0, 500)}`);
  }
  return bodyOut[responseKey] as Record<string, unknown>;
}

function checkArcaErrors(result: Record<string, unknown> | undefined, context: string): void {
  if (!result) return;
  const errors = result.Errors as { Err?: unknown } | undefined;
  if (!errors || !errors.Err) return;
  const errs = Array.isArray(errors.Err) ? errors.Err : [errors.Err];
  const msgs = errs
    .map((e) => {
      const er = e as { Code?: number; Msg?: string };
      return `[${er.Code}] ${er.Msg}`;
    })
    .join("; ");
  throw new Error(`ARCA ${context}: ${msgs}`);
}

// ── Métodos de WSFEv1 ────────────────────────────────────────────────────────

/** Devuelve el último número autorizado para un (PtoVta, CbteTipo). */
export async function feCompUltimoAutorizado(
  ticket: AccessTicket,
  cuit: string,
  ptoVta: number,
  cbteTipo: number
): Promise<number> {
  const auth = authFromTicket(ticket, cuit);
  const inner = `<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`;
  const resp = await callSoap("FECompUltimoAutorizado", inner, auth);
  const result = resp.FECompUltimoAutorizadoResult as Record<string, unknown> | undefined;
  checkArcaErrors(result, "FECompUltimoAutorizado");
  const cbteNro = result?.CbteNro as number | undefined;
  return Number(cbteNro ?? 0);
}

/** Trae el detalle completo de un comprobante específico. */
export type Comprobante = {
  CbteTipo: number;
  PtoVta: number;
  CbteDesde: number;
  CbteHasta: number;
  CbteFch?: string;        // YYYYMMDD
  ImpTotal?: number;
  ImpTotConc?: number;
  ImpNeto?: number;
  ImpOpEx?: number;
  ImpIVA?: number;
  ImpTrib?: number;
  MonId?: string;
  MonCotiz?: number;
  DocTipo?: number;
  DocNro?: number;
  CodAutorizacion?: string; // CAE
  FchVto?: string;          // YYYYMMDD
  Resultado?: string;
  EmisionTipo?: string;
  Iva?: unknown;
  Tributos?: unknown;
  Observaciones?: unknown;
};

export async function feCompConsultar(
  ticket: AccessTicket,
  cuit: string,
  ptoVta: number,
  cbteTipo: number,
  cbteNro: number
): Promise<Comprobante | null> {
  const auth = authFromTicket(ticket, cuit);
  const inner = `<ar:FeCompConsReq>
    <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>
    <ar:CbteNro>${cbteNro}</ar:CbteNro>
    <ar:PtoVta>${ptoVta}</ar:PtoVta>
  </ar:FeCompConsReq>`;
  const resp = await callSoap("FECompConsultar", inner, auth);
  const result = resp.FECompConsultarResult as Record<string, unknown> | undefined;
  checkArcaErrors(result, "FECompConsultar");
  const resultGet = result?.ResultGet as Comprobante | undefined;
  return resultGet ?? null;
}

/** Lista los puntos de venta habilitados. */
export async function feParamGetPtosVenta(
  ticket: AccessTicket,
  cuit: string
): Promise<Array<{ Nro: number; EmisionTipo: string; Bloqueado: string; FchBaja?: string }>> {
  const auth = authFromTicket(ticket, cuit);
  const resp = await callSoap("FEParamGetPtosVenta", "", auth);
  const result = resp.FEParamGetPtosVentaResult as Record<string, unknown> | undefined;
  checkArcaErrors(result, "FEParamGetPtosVenta");
  const result2 = result?.ResultGet as { PtoVenta?: unknown } | undefined;
  if (!result2?.PtoVenta) return [];
  const arr = Array.isArray(result2.PtoVenta) ? result2.PtoVenta : [result2.PtoVenta];
  return arr as Array<{ Nro: number; EmisionTipo: string; Bloqueado: string; FchBaja?: string }>;
}

/** Lista los tipos de comprobante. */
export async function feParamGetTiposCbte(
  ticket: AccessTicket,
  cuit: string
): Promise<Array<{ Id: number; Desc: string; FchDesde?: string; FchHasta?: string }>> {
  const auth = authFromTicket(ticket, cuit);
  const resp = await callSoap("FEParamGetTiposCbte", "", auth);
  const result = resp.FEParamGetTiposCbteResult as Record<string, unknown> | undefined;
  checkArcaErrors(result, "FEParamGetTiposCbte");
  const result2 = result?.ResultGet as { CbteTipo?: unknown } | undefined;
  if (!result2?.CbteTipo) return [];
  const arr = Array.isArray(result2.CbteTipo) ? result2.CbteTipo : [result2.CbteTipo];
  return arr as Array<{ Id: number; Desc: string; FchDesde?: string; FchHasta?: string }>;
}

/** Heartbeat: verifica que servidores+DB+auth estén funcionando. */
export async function feDummy(): Promise<{ AppServer?: string; DbServer?: string; AuthServer?: string }> {
  const fakeAuth: Auth = { token: "", sign: "", cuit: "" };
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}">
  <soapenv:Body><ar:FEDummy/></soapenv:Body>
</soapenv:Envelope>`;
  const res = await fetch(WSFEV1_URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `${NS}FEDummy` },
    body: envelope,
  });
  const text = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const doc = parser.parse(text) as Record<string, unknown>;
  const envOut = (doc.Envelope ?? {}) as Record<string, unknown>;
  const bodyOut = (envOut.Body ?? {}) as Record<string, unknown>;
  const respKey = Object.keys(bodyOut).find((k) => k.endsWith("Response"));
  const result = (respKey ? (bodyOut[respKey] as Record<string, unknown>) : {}).FEDummyResult;
  void fakeAuth;
  return (result ?? {}) as { AppServer?: string; DbServer?: string; AuthServer?: string };
}
