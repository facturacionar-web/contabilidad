import forge from "node-forge";
import { XMLParser } from "fast-xml-parser";
import type { SupabaseClient } from "@supabase/supabase-js";
import { URLS, getCredentials } from "./config";

export type AccessTicket = {
  token: string;
  sign: string;
  expiraAt: Date;
};

const WSAA_URL = URLS[
  (process.env.ARCA_ENV as "homologacion" | "produccion") === "homologacion"
    ? "homologacion"
    : "produccion"
].wsaa;

function buildLoginTicketRequest(service: string): string {
  const now = Date.now();
  const generationTime = new Date(now - 60_000).toISOString();
  const expirationTime = new Date(now + 600_000).toISOString();
  const uniqueId = Math.floor(now / 1000);

  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${generationTime}</generationTime>
    <expirationTime>${expirationTime}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`;
}

function signCMS(tra: string, certPem: string, keyPem: string): string {
  const cert = forge.pki.certificateFromPem(certPem);
  const privateKey = forge.pki.privateKeyFromPem(keyPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({
    key: privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
    ],
  });
  p7.sign({ detached: false });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

function buildLoginCmsSoap(cmsBase64: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cmsBase64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function parseLoginCmsResponse(soapXml: string): AccessTicket {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
  });
  const doc = parser.parse(soapXml) as Record<string, unknown>;

  const envelope = (doc.Envelope ?? {}) as Record<string, unknown>;
  const body = (envelope.Body ?? {}) as Record<string, unknown>;

  const fault = body.Fault as { faultstring?: string } | undefined;
  if (fault) {
    throw new Error(`WSAA fault: ${fault.faultstring ?? JSON.stringify(fault)}`);
  }

  const loginCmsResponse = body.loginCmsResponse as { loginCmsReturn?: string } | undefined;
  const innerXml = loginCmsResponse?.loginCmsReturn;
  if (!innerXml) {
    throw new Error(`WSAA: respuesta sin loginCmsReturn. SOAP: ${soapXml.slice(0, 500)}`);
  }

  const inner = parser.parse(innerXml) as Record<string, unknown>;
  const lt = (inner.loginTicketResponse ?? {}) as Record<string, unknown>;
  const header = (lt.header ?? {}) as Record<string, unknown>;
  const credentials = (lt.credentials ?? {}) as { token?: string; sign?: string };

  if (!credentials.token || !credentials.sign) {
    throw new Error(`WSAA: respuesta sin token/sign. Inner: ${innerXml.slice(0, 500)}`);
  }

  const expirationTime = header.expirationTime as string | undefined;
  const expiraAt = expirationTime ? new Date(expirationTime) : new Date(Date.now() + 11 * 3600_000);

  return { token: credentials.token, sign: credentials.sign, expiraAt };
}

async function callLoginCms(cmsBase64: string): Promise<string> {
  const soap = buildLoginCmsSoap(cmsBase64);
  const res = await fetch(WSAA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "",
    },
    body: soap,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WSAA HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return text;
}

/**
 * Devuelve un Access Ticket válido. Usa cache en Supabase (válido 12hs).
 * Si no hay cache o está expirado, hace login contra WSAA y guarda.
 */
export async function getAccessTicket(
  supabase: SupabaseClient,
  userId: string,
  service: string = "wsfe"
): Promise<AccessTicket> {
  const margin = 60_000;
  const { data: cached } = await supabase
    .from("arca_wsaa_cache")
    .select("token, sign, expira_at")
    .eq("user_id", userId)
    .eq("service", service)
    .maybeSingle();

  if (cached && new Date(cached.expira_at).getTime() > Date.now() + margin) {
    return {
      token: cached.token,
      sign: cached.sign,
      expiraAt: new Date(cached.expira_at),
    };
  }

  const { certPem, keyPem } = getCredentials();
  const tra = buildLoginTicketRequest(service);
  const cms = signCMS(tra, certPem, keyPem);
  const soapResponse = await callLoginCms(cms);
  const ticket = parseLoginCmsResponse(soapResponse);

  const { error } = await supabase
    .from("arca_wsaa_cache")
    .upsert({
      user_id: userId,
      service,
      token: ticket.token,
      sign: ticket.sign,
      expira_at: ticket.expiraAt.toISOString(),
      updated_at: new Date().toISOString(),
    });
  if (error) {
    console.error("[wsaa] no se pudo cachear TA:", error.message);
  }

  return ticket;
}
