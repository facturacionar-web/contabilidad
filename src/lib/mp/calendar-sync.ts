import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken } from "@/lib/ml/oauth";
import { mpJson } from "./api";
import { AR_TZ_OFFSET } from "./config";
import { listMpSellers, type MpSeller } from "./sellers";

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

export type CalendarSyncSellerResult = {
  mpUserId: number;
  cuentaNombre: string;
  totalApi: number;
  upserted: number;
  errores: string[];
};

export type CalendarSyncResult = {
  rango: { begin: string; end: string };
  totalApi: number;
  upserted: number;
  errores: string[];
  porSeller: CalendarSyncSellerResult[];
};

/**
 * Refresca `mp_release_calendar` para TODAS las cuentas MP configuradas en
 * `cuentas.mp_user_id` (o solo una si se pasa `mpUserId` filter).
 */
export async function syncCalendar(
  supabase: SupabaseClient,
  userId: string,
  options: {
    diasHaciaAtras?: number;
    diasHaciaAdelante?: number;
    mpUserId?: number;     // opcional: filtra a un seller específico
  } = {},
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

  // Sellers a procesar
  let sellers = await listMpSellers(supabase, userId);
  if (options.mpUserId) {
    sellers = sellers.filter((s) => s.mpUserId === options.mpUserId);
    if (sellers.length === 0) {
      return {
        rango: { begin: beginIso, end: endIso },
        totalApi: 0, upserted: 0,
        errores: [`mp_user_id ${options.mpUserId} no configurado en cuentas.mp_user_id`],
        porSeller: [],
      };
    }
  }
  if (sellers.length === 0) {
    return {
      rango: { begin: beginIso, end: endIso },
      totalApi: 0, upserted: 0,
      errores: ["no hay cuentas con mp_user_id configurado"],
      porSeller: [],
    };
  }

  const porSeller: CalendarSyncSellerResult[] = [];
  let totalApiSum = 0;
  let upsertedSum = 0;
  const erroresGlobal: string[] = [];

  for (const seller of sellers) {
    const r = await syncCalendarForSeller(supabase, userId, seller, beginIso, endIso);
    porSeller.push(r);
    totalApiSum += r.totalApi;
    upsertedSum += r.upserted;
    if (r.errores.length > 0) {
      for (const e of r.errores) erroresGlobal.push(`[${seller.cuentaNombre}] ${e}`);
    }
  }

  return { rango: { begin: beginIso, end: endIso }, totalApi: totalApiSum, upserted: upsertedSum, errores: erroresGlobal, porSeller };
}

async function syncCalendarForSeller(
  supabase: SupabaseClient,
  userId: string,
  seller: MpSeller,
  beginIso: string,
  endIso: string,
): Promise<CalendarSyncSellerResult> {
  const errores: string[] = [];
  let accessToken: string;
  try {
    accessToken = await getAccessToken(supabase, userId, seller.mpUserId);
  } catch (err) {
    return {
      mpUserId: seller.mpUserId, cuentaNombre: seller.cuentaNombre,
      totalApi: 0, upserted: 0,
      errores: [`OAuth: ${String(err).slice(0, 200)}`],
    };
  }

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

  // Dedup por mp_payment_id
  const byId = new Map<number, MpPayment>();
  for (const p of todos) {
    if (!p.money_release_date) continue;
    byId.set(Number(p.id), p);
  }

  const rows = Array.from(byId.values()).map((p) => {
    const releaseAt = new Date(p.money_release_date as string);
    return {
      user_id: userId,
      mp_payment_id: Number(p.id),
      mp_user_id: Number(p.collector_id ?? seller.mpUserId),
      fecha_liberacion: ymdLocal(releaseAt),
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
    if (error) errores.push(`upsert chunk ${i}: ${error.message}`);
    else upserted += slice.length;
  }

  return { mpUserId: seller.mpUserId, cuentaNombre: seller.cuentaNombre, totalApi: total, upserted, errores };
}

function numOr0(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/** YYYY-MM-DD en local AR (offset -03:00). */
function ymdLocal(d: Date): string {
  const offsetMs = 3 * 60 * 60 * 1000;
  const adjusted = new Date(d.getTime() - offsetMs);
  return adjusted.toISOString().slice(0, 10);
}
