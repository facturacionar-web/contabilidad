import { mpFetch, mpJson } from "./api";

type ReportListItem = {
  id: number;
  file_name: string;
  begin_date: string;       // UTC con sufijo Z (sin ms)
  end_date: string;
  status: string;           // "enabled" cuando ya está listo para descargar
  date_created: string;
  created_from?: string;    // "manual" | "schedule"
  format?: string;          // "CSV" | "XLSX"
  sub_type?: string;
};

/**
 * Convierte una fecha ISO cualquiera al formato exigido por MP:
 * UTC con sufijo Z y SIN milisegundos. Otros formatos (offset -03:00,
 * .000Z) responden 400 con "Must specify begin_date parameter".
 */
function toMpDate(s: string): string {
  return new Date(s).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Pide a MP que genere un release_report para el rango [begin, end].
 * Devuelve el id devuelto por el POST + el ts del request (para deduplicar
 * en el polling — el ID del POST no aparece en /list, hay que matchear por
 * begin/end y por timestamp).
 */
export async function requestReleaseReport(
  accessToken: string,
  beginIso: string,
  endIso: string,
): Promise<{ id: number; status: string; beginUtc: string; endUtc: string; requestedAt: Date }> {
  const beginUtc = toMpDate(beginIso);
  const endUtc = toMpDate(endIso);
  const requestedAt = new Date();
  const body = JSON.stringify({ begin_date: beginUtc, end_date: endUtc });
  const r = await mpJson<{ id: number; status: string }>(
    accessToken,
    "/v1/account/release_report",
    { method: "POST", headers: { "Content-Type": "application/json" }, body },
  );
  return { ...r, beginUtc, endUtc, requestedAt };
}

/** Lista los release_reports disponibles para descargar. */
export async function listReleaseReports(accessToken: string): Promise<ReportListItem[]> {
  return mpJson<ReportListItem[]>(accessToken, "/v1/account/release_report/list");
}

/**
 * Pollea hasta que aparezca en /list un report manual con begin/end
 * coincidentes Y date_created posterior al requestedAt. MP usa status
 * "enabled" en /list cuando el archivo está listo para descargar.
 */
export async function waitForReportReady(
  accessToken: string,
  beginUtc: string,
  endUtc: string,
  requestedAt: Date,
  timeoutMs: number = 9 * 60 * 1000,
  intervalMs: number = 15_000,
): Promise<ReportListItem> {
  const start = Date.now();
  let lastSeen = "no candidate";
  // Damos un margen de 30s para evitar problemas de skew entre relojes
  const minDate = new Date(requestedAt.getTime() - 30_000);

  while (Date.now() - start < timeoutMs) {
    const list = await listReleaseReports(accessToken);
    const candidates = list.filter(
      (r) =>
        r.begin_date === beginUtc &&
        r.end_date === endUtc &&
        r.created_from === "manual" &&
        new Date(r.date_created) >= minDate,
    );
    if (candidates.length > 0) {
      const newest = candidates.sort((a, b) =>
        b.date_created > a.date_created ? 1 : -1,
      )[0];
      if (newest.status === "enabled" || newest.status === "processed") return newest;
      lastSeen = `id=${newest.id} status=${newest.status}`;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `release_report ${beginUtc}..${endUtc} no quedó listo en ${timeoutMs}ms (último: ${lastSeen})`,
  );
}

/** Descarga el archivo (CSV o XLSX) por file_name. */
export async function downloadReport(
  accessToken: string,
  fileName: string,
): Promise<{ contentType: string; body: ArrayBuffer; text: string | null }> {
  const r = await mpFetch(accessToken, `/v1/account/release_report/${fileName}`);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`download ${fileName} → ${r.status}: ${t.slice(0, 300)}`);
  }
  const ct = r.headers.get("content-type") ?? "";
  const body = await r.arrayBuffer();
  const isText =
    ct.includes("csv") || ct.includes("text/") || fileName.toLowerCase().endsWith(".csv");
  const text = isText ? new TextDecoder("utf-8").decode(body) : null;
  return { contentType: ct, body, text };
}
