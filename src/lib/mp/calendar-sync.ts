import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken } from "@/lib/ml/oauth";
import { mpJson } from "./api";
import { AR_TZ_OFFSET, DEFAULT_MP_USER_ID } from "./config";

type MpPayment = {
  id: number | string;
  status: string;
  money_release_status?: string;
  money_release_date?: string;
  date_created?: string;
  transaction_amount?: number | string;
  operation_type?: string;
  external_reference?: string | null;
  collector_id?: number | string;
  transaction_details?: {
    net_received_amount?: number | string;
  };
};

type SearchResp = {
  results: MpPayment[];
  paging: { total: number; limit: number; offset: number };
};

export type CalendarSyncResult = {
  rango: { begin: string; end: string };
  totalApi: number;
  upserted: number;
  errores: string[];
};

/**
 * Refresca `mp_release_calendar` con los pagos cuyo money_release_date cae
 * en el rango [diasHaciaAtras, diasHaciaAdelante]. Default: -7d a +60d.
 *
 * Lógica:
 *  - Trae TODOS los pagos en el rango (sin filtrar status: incluye approved
 *    + in_mediation, validado contra el dashboard al centavo el 13 y 14 de mayo).
 *  - Upsert por mp_payment_id; si un pago se actualiza (release_date cambia,
 *    status cambia), se sobrescribe.
 */
export async function syncCalendar(
  supabase: SupabaseClient,
  userId: string,
  options: { diasHaciaAtras?: number; diasHaciaAdelante?: number } = {},
): Promise<CalendarSyncResult> {
  const diasAtras = options.diasHaciaAtras ?? 7;
  const diasAdelante = options.diasHaciaAdelante ?? 60;

  const now = new Date();
  const begin = new Date(now);
  begin.setDate(begin.getDate() - diasAtras);
  const end = new Date(now);
  end.setDate(end.getDate() + diasAdelante);
  const beginIso = `${begin.toISOString().slice(0, 10)}T00:00:00.000${AR_TZ_OFFSET}`;
  const endIso = `${end.toISOString().slice(0, 10)}T23:59:59.999${AR_TZ_OFFSET}`;

  const mpUserId = DEFAULT_MP_USER_ID;
  const accessToken = await getAccessToken(supabase, userId, mpUserId);

  const errores: string[] = [];
  const todos: MpPayment[] = [];
  const limit = 50;
  let offset = 0;
  let total = 0;

  while (true) {
    const path =
      `/v1/payments/search?range=money_release_date` +
      `&begin_date=${encodeURIComponent(beginIso)}&end_date=${encodeURIComponent(endIso)}` +
      `&limit=${limit}&offset=${offset}&sort=money_release_date&criteria=asc`;
    let resp: SearchResp;
    try {
      resp = await mpJson<SearchResp>(accessToken, path);
    } catch (err) {
      errores.push(`page offset=${offset}: ${String(err).slice(0, 200)}`);
      break;
    }
    total = resp.paging.total;
    todos.push(...resp.results);
    if (resp.results.length < limit) break;
    offset += limit;
    if (offset >= total) break;
    if (offset > 10000) {
      errores.push("offset > 10000 — abortando para evitar paginar infinito");
      break;
    }
  }

  // Dedup por mp_payment_id (la API puede traer el mismo pago 2 veces si se
  // actualizó durante la paginación) — nos quedamos con la última versión.
  const byId = new Map<number, MpPayment>();
  for (const p of todos) {
    if (!p.money_release_date) continue;
    byId.set(Number(p.id), p);
  }

  // upsert en chunks
  const rows = Array.from(byId.values())
    .map((p) => {
      const releaseAt = new Date(p.money_release_date as string);
      const fechaLib = ymdLocal(releaseAt);
      return {
        user_id: userId,
        mp_payment_id: Number(p.id),
        mp_user_id: Number(p.collector_id ?? mpUserId),
        fecha_liberacion: fechaLib,
        money_release_at: releaseAt.toISOString(),
        net_received_amount: numOr0(p.transaction_details?.net_received_amount),
        transaction_amount: numOr0(p.transaction_amount),
        payment_status: p.status,
        money_release_status: p.money_release_status ?? "pending",
        operation_type: p.operation_type ?? null,
        external_reference: p.external_reference ?? null,
        date_created: p.date_created ?? null,
        updated_at: new Date().toISOString(),
      };
    });

  let upserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("mp_release_calendar")
      .upsert(slice, { onConflict: "user_id,mp_payment_id" });
    if (error) {
      errores.push(`upsert chunk ${i}: ${error.message}`);
    } else {
      upserted += slice.length;
    }
  }

  return { rango: { begin: beginIso, end: endIso }, totalApi: total, upserted, errores };
}

function numOr0(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/** YYYY-MM-DD en local AR (offset -03:00). */
function ymdLocal(d: Date): string {
  // Convertimos manualmente para evitar problemas con TZ del runtime (Railway = UTC).
  const offsetMs = 3 * 60 * 60 * 1000; // AR es UTC-3 (sin DST)
  const adjusted = new Date(d.getTime() - offsetMs);
  return adjusted.toISOString().slice(0, 10);
}
