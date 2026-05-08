import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAuth } from "@/lib/arca/auth";
import { getAccessToken } from "@/lib/ml/oauth";
import { getBillingInfo } from "@/lib/ml/orders";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CONCURRENCY = 10;

async function parallelMap<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i]);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

type Pendiente = { id: number; ml_order_id: number; ml_seller_id: number };

async function procesarBatch(
  supabase: SupabaseClient,
  pendientes: Pendiente[],
  userId: string,
): Promise<{ ok: number; sinDoc: number; errores: string[] }> {
  const result = { ok: 0, sinDoc: 0, errores: [] as string[] };

  // Cachear access tokens por seller
  const tokenCache = new Map<number, string>();

  await parallelMap(
    pendientes,
    async (p) => {
      try {
        let token = tokenCache.get(p.ml_seller_id);
        if (!token) {
          token = await getAccessToken(supabase, userId, p.ml_seller_id);
          tokenCache.set(p.ml_seller_id, token);
        }

        const billing = await getBillingInfo(token, p.ml_order_id);
        if (!billing) {
          await supabase
            .from("ml_ordenes")
            .update({ billing_synced_at: new Date().toISOString() })
            .eq("id", p.id);
          result.sinDoc += 1;
          return;
        }

        const docNum = billing.doc_number?.replace(/\D/g, "");
        const update: Record<string, unknown> = {
          billing_synced_at: new Date().toISOString(),
        };
        if (docNum) {
          update.doc_nro_buyer = Number(docNum);
          update.doc_tipo_buyer = billing.doc_type ?? null;
        }

        const { error } = await supabase
          .from("ml_ordenes")
          .update(update)
          .eq("id", p.id);

        if (error) {
          result.errores.push(`id ${p.id}: ${error.message}`);
          return;
        }
        if (docNum) result.ok += 1;
        else result.sinDoc += 1;
      } catch (e) {
        result.errores.push(`order ${p.ml_order_id}: ${String(e)}`);
      }
    },
    CONCURRENCY,
  );

  return result;
}

/**
 * POST /api/ml/backfill-billing
 * Body opcional: { maxPorTanda?: number }
 *
 * Trae billing_info para todas las órdenes que tengan billing_synced_at null,
 * llenando doc_tipo_buyer y doc_nro_buyer. Se ejecuta en paralelo (concurrencia 10).
 */
export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { supabase, userId } = auth;

  let body: { maxPorTanda?: number } = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  const maxPorTanda = Math.min(body.maxPorTanda ?? 500, 2000);

  // Pendientes: status paid/partially_paid (los que vamos a conciliar) sin billing_synced_at
  const { data: pendientes, error } = await supabase
    .from("ml_ordenes")
    .select("id, ml_order_id, ml_seller_id")
    .in("status", ["paid", "partially_paid"])
    .is("billing_synced_at", null)
    .limit(maxPorTanda);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!pendientes || pendientes.length === 0) {
    return NextResponse.json({ ok: true, procesadas: 0, mensaje: "no hay pendientes" });
  }

  const resultado = await procesarBatch(supabase, pendientes as Pendiente[], userId);

  return NextResponse.json({
    ok: true,
    procesadas: pendientes.length,
    conDoc: resultado.ok,
    sinDoc: resultado.sinDoc,
    errores: resultado.errores.slice(0, 10),
    erroresTotal: resultado.errores.length,
  });
}
