import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken } from "@/lib/ml/oauth";
import {
  AR_TZ_OFFSET,
  CONCEPTO_ID_LIQUIDACION_MP,
  CONCEPTO_ID_TRANSFERENCIAS_PROPIAS,
} from "./config";
import { parseAmount, parseReleaseCsv, type ReleaseRow } from "./csv-parser";
import {
  downloadReport,
  requestReleaseReport,
  waitForReportReady,
} from "./release-report";
import { listMpSellers, type MpSeller } from "./sellers";

export type CierreDiarioSellerResult = {
  mpUserId: number;
  cuentaNombre: string;
  reportId: number;
  fileName: string;
  filasCsv: number;
  filasInsertadasDetalle: number;
  netoIngreso: number;
  totalPayouts: number;
  cantidadPayouts: number;
  balanceFinal: number | null;
  alegrantIngresoId: number | null;
  withdrawals: Array<{
    monto: number;
    cbu: string;
    cuentaDestinoMatched: boolean;
    gastoId: number | null;
    ingresoId: number | null;
  }>;
  yaCerrado: boolean;
  warnings: string[];
};

export type CierreDiarioResult = {
  fecha: string;
  porSeller: CierreDiarioSellerResult[];
  // Agregados para compatibilidad con clientes que asumen 1 seller:
  netoIngresoTotal: number;
  totalPayoutsTotal: number;
};

/**
 * Cierra contablemente el día `fecha` (YYYY-MM-DD) para TODAS las cuentas MP
 * con `mp_user_id` configurado en `cuentas`, o solo una si se pasa filter.
 * Idempotente por seller.
 */
export async function cerrarDiaMp(
  supabase: SupabaseClient,
  userId: string,
  fechaYmd: string,
  options: { mpUserId?: number } = {},
): Promise<CierreDiarioResult> {
  let sellers = await listMpSellers(supabase, userId);
  if (options.mpUserId) {
    sellers = sellers.filter((s) => s.mpUserId === options.mpUserId);
  }
  if (sellers.length === 0) {
    throw new Error(
      `No hay cuentas con mp_user_id configurado${options.mpUserId ? ` (filtro mpUserId=${options.mpUserId})` : ""}.`,
    );
  }

  const porSeller: CierreDiarioSellerResult[] = [];
  for (const seller of sellers) {
    try {
      const r = await cerrarDiaMpForSeller(supabase, userId, fechaYmd, seller);
      porSeller.push(r);
    } catch (err) {
      porSeller.push({
        mpUserId: seller.mpUserId,
        cuentaNombre: seller.cuentaNombre,
        reportId: 0, fileName: "",
        filasCsv: 0, filasInsertadasDetalle: 0,
        netoIngreso: 0, totalPayouts: 0, cantidadPayouts: 0,
        balanceFinal: null, alegrantIngresoId: null,
        withdrawals: [],
        yaCerrado: false,
        warnings: [`ERROR: ${String(err).slice(0, 400)}`],
      });
    }
  }

  return {
    fecha: fechaYmd,
    porSeller,
    netoIngresoTotal: porSeller.reduce((s, r) => s + r.netoIngreso, 0),
    totalPayoutsTotal: porSeller.reduce((s, r) => s + r.totalPayouts, 0),
  };
}

/**
 * Flujo de cierre para un solo seller MP. Idempotente: si ya hay registro
 * en mp_liquidaciones_diarias para (user_id, mp_user_id, fecha), no hace nada.
 */
async function cerrarDiaMpForSeller(
  supabase: SupabaseClient,
  userId: string,
  fechaYmd: string,
  seller: MpSeller,
): Promise<CierreDiarioSellerResult> {
  const warnings: string[] = [];
  const mpUserId = seller.mpUserId;

  // 1) idempotencia
  const { data: yaExiste } = await supabase
    .from("mp_liquidaciones_diarias")
    .select("alegrant_ingreso_id, total_neto, total_payouts")
    .eq("user_id", userId)
    .eq("mp_user_id", mpUserId)
    .eq("fecha", fechaYmd)
    .maybeSingle();

  if (yaExiste) {
    return {
      mpUserId, cuentaNombre: seller.cuentaNombre,
      reportId: 0, fileName: "",
      filasCsv: 0, filasInsertadasDetalle: 0,
      netoIngreso: Number(yaExiste.total_neto),
      totalPayouts: Number(yaExiste.total_payouts),
      cantidadPayouts: 0,
      balanceFinal: null,
      alegrantIngresoId: yaExiste.alegrant_ingreso_id ?? null,
      withdrawals: [],
      yaCerrado: true,
      warnings: ["día ya cerrado — no se hace nada"],
    };
  }

  // 2) request release_report
  const accessToken = await getAccessToken(supabase, userId, mpUserId);
  const beginIso = `${fechaYmd}T00:00:00${AR_TZ_OFFSET}`;
  const endIso = `${fechaYmd}T23:59:59${AR_TZ_OFFSET}`;
  const requested = await requestReleaseReport(accessToken, beginIso, endIso);

  // 3) poll
  const ready = await waitForReportReady(
    accessToken,
    requested.beginUtc,
    requested.endUtc,
    requested.requestedAt,
  );

  // 4) descarga + parse
  const { text, contentType } = await downloadReport(accessToken, ready.file_name);
  if (!text) {
    throw new Error(
      `Reporte ${ready.file_name} no es CSV (content-type=${contentType}).`,
    );
  }
  const rows = parseReleaseCsv(text);

  // 5) insertar detalle
  const detailRows = rows
    .filter((r) => r.RECORD_TYPE === "release")
    .map((r) => mapRowToDetail(r, userId, mpUserId, fechaYmd, ready.file_name));

  let filasInsertadasDetalle = 0;
  const CHUNK = 500;
  for (let i = 0; i < detailRows.length; i += CHUNK) {
    const slice = detailRows.slice(i, i + CHUNK);
    const { error, count } = await supabase
      .from("mp_release_detail")
      .upsert(slice, {
        onConflict: "user_id,fecha,source_id,description,net_credit,net_debit,gross_amount",
        ignoreDuplicates: true,
        count: "exact",
      });
    if (error) warnings.push(`detalle chunk ${i}: ${error.message}`);
    else filasInsertadasDetalle += count ?? slice.length;
  }

  // 6) calcular totales y separar payouts
  let netoIngreso = 0;
  let totalPayouts = 0;
  let balanceFinal: number | null = null;
  const payoutRows: ReleaseRow[] = [];
  for (const r of rows) {
    if (r.RECORD_TYPE === "total") {
      const c = parseAmount(r.NET_CREDIT_AMOUNT);
      const d = parseAmount(r.NET_DEBIT_AMOUNT);
      balanceFinal = c - d;
      continue;
    }
    if (r.RECORD_TYPE !== "release") continue;
    const credit = parseAmount(r.NET_CREDIT_AMOUNT);
    const debit = parseAmount(r.NET_DEBIT_AMOUNT);
    if (r.DESCRIPTION === "payout") {
      totalPayouts += debit;
      payoutRows.push(r);
    } else {
      netoIngreso += credit - debit;
    }
  }
  netoIngreso = Math.round(netoIngreso * 100) / 100;
  totalPayouts = Math.round(totalPayouts * 100) / 100;

  // 7) buscar cuenta MP
  const cuentaMp = await findCuentaMp(supabase, userId, mpUserId);
  if (!cuentaMp) {
    throw new Error(`Cuenta MP no encontrada para mp_user_id=${mpUserId}`);
  }

  // 8) crear ingreso del día (cuenta MP)
  let alegrantIngresoId: number | null = null;
  if (netoIngreso !== 0) {
    const { data: ing, error: ingErr } = await supabase
      .from("ingresos")
      .insert({
        user_id: userId,
        fecha: fechaYmd,
        tipo: "ingreso_dinero",
        concepto: "Liquidacion diaria MP",
        categoria: "Liquidacion diaria MP",
        concepto_id: CONCEPTO_ID_LIQUIDACION_MP,
        monto: netoIngreso,
        moneda: "ARS",
        metodo_pago: "transferencia",
        referencia: `mp_release_report:${ready.file_name}`,
        notas: `${seller.cuentaNombre} ${formatDateAR(fechaYmd)} — ${detailRows.length} mov, balance final $${balanceFinal?.toLocaleString("es-AR") ?? "n/a"}`,
        ctx_pais: "AR",
        cuenta_id: cuentaMp.id,
        tasa_cambio: 1,
      })
      .select("id")
      .single();
    if (ingErr) warnings.push(`insertar ingreso día: ${ingErr.message}`);
    else alegrantIngresoId = Number(ing.id);
  }

  // 9) por cada payout
  const withdrawalsOut: CierreDiarioSellerResult["withdrawals"] = [];
  for (const pr of payoutRows) {
    const monto = parseAmount(pr.NET_DEBIT_AMOUNT);
    const cbu = (pr.PAYOUT_BANK_ACCOUNT_NUMBER || "").trim();
    if (!cbu) {
      warnings.push(`payout sin CBU destino: ${pr.SOURCE_ID}`);
      continue;
    }
    const cuentaDestino = await findCuentaPorCbu(supabase, userId, cbu);

    const { data: detRow } = await supabase
      .from("mp_release_detail")
      .select("id")
      .eq("user_id", userId)
      .eq("fecha", fechaYmd)
      .eq("description", "payout")
      .eq("net_debit", monto)
      .eq("source_id", pr.SOURCE_ID || "")
      .maybeSingle();

    let gastoId: number | null = null;
    let ingresoDestinoId: number | null = null;

    if (cuentaDestino) {
      // ── PAYOUT A CUENTA PROPIA (transferencia entre cuentas)
      // El usuario movió plata de MP a otra cuenta propia. El cron registra:
      //   - Gasto en MP por el monto total
      //   - Ingreso en cuenta destino por el monto total
      const destinoLabel = cuentaDestino.nombre;
      const { data: gasto, error: gastoErr } = await supabase
        .from("gastos")
        .insert({
          user_id: userId,
          fecha: fechaYmd,
          tipo: "gasto",
          contacto_id: null,
          concepto: "Transferencias a cuentas propias",
          categoria: "Transferencias a cuentas propias",
          concepto_id: CONCEPTO_ID_TRANSFERENCIAS_PROPIAS,
          subtotal: monto, iva: 0, iva_monto: 0,
          total: monto, moneda: "ARS",
          estado: "pagado", metodo_pago: "transferencia",
          monto_pagado: monto,
          notas: `${seller.cuentaNombre} → ${destinoLabel} (source_id ${pr.SOURCE_ID})`,
          ctx_pais: "AR",
          cuenta_id: cuentaMp.id,
          tasa_cambio: 1,
        })
        .select("id").single();
      if (gastoErr) warnings.push(`gasto transfer: ${gastoErr.message}`);
      else gastoId = Number(gasto.id);

      const { data: ing, error: ingErr } = await supabase
        .from("ingresos")
        .insert({
          user_id: userId,
          fecha: fechaYmd,
          tipo: "ingreso_dinero",
          concepto: "Transferencias a cuentas propias",
          categoria: "Transferencias a cuentas propias",
          concepto_id: CONCEPTO_ID_TRANSFERENCIAS_PROPIAS,
          monto: monto, moneda: "ARS",
          metodo_pago: "transferencia",
          referencia: `mp_payout:${pr.SOURCE_ID}`,
          notas: `${seller.cuentaNombre} → ${destinoLabel}`,
          ctx_pais: "AR",
          cuenta_id: cuentaDestino.id,
          tasa_cambio: 1,
        })
        .select("id").single();
      if (ingErr) warnings.push(`ingreso destino transfer: ${ingErr.message}`);
      else ingresoDestinoId = Number(ing.id);
    } else {
      // ── PAYOUT A DESTINO NO MAPEADO (típicamente pago a proveedor)
      // No registramos nada en Alegrant: el usuario carga manualmente la
      // factura del proveedor y, si corresponde, el impuesto a débitos/créditos.
      // Solo dejamos el rastro en mp_withdrawals (abajo) y un warning.
      const cbuTail = cbu.slice(-6);
      warnings.push(`CBU …${cbuTail} (payout MP ${pr.SOURCE_ID}, $${monto.toLocaleString("es-AR")}) no mapeada — sin asiento contable. Si era cuenta propia, agregá UPDATE cuentas SET cbu='${cbu}' WHERE nombre='...';`);
    }

    const fechaPayout = pr.DATE
      ? new Date(pr.DATE).toISOString()
      : `${fechaYmd}T00:00:00${AR_TZ_OFFSET}`;
    const { error: wErr } = await supabase
      .from("mp_withdrawals")
      .upsert(
        {
          user_id: userId,
          mp_user_id: mpUserId,
          fecha: fechaPayout,
          monto,
          cbu_destino: cbu,
          mp_release_detail_id: detRow?.id ?? null,
          cuenta_origen_id: cuentaMp.id,
          cuenta_destino_id: cuentaDestino?.id ?? null,
          alegrant_gasto_id: gastoId,
          alegrant_ingreso_id: ingresoDestinoId,
        },
        { onConflict: "user_id,fecha,monto,cbu_destino" },
      );
    if (wErr) warnings.push(`mp_withdrawals upsert: ${wErr.message}`);

    withdrawalsOut.push({
      monto, cbu,
      cuentaDestinoMatched: !!cuentaDestino,
      gastoId,
      ingresoId: ingresoDestinoId,
    });
  }

  // 10) mp_liquidaciones_diarias
  const { error: liqErr } = await supabase.from("mp_liquidaciones_diarias").insert({
    user_id: userId,
    mp_user_id: mpUserId,
    fecha: fechaYmd,
    cantidad_movimientos: detailRows.length,
    total_neto: netoIngreso,
    total_payouts: totalPayouts,
    balance_final: balanceFinal,
    alegrant_ingreso_id: alegrantIngresoId,
  });
  if (liqErr) warnings.push(`mp_liquidaciones_diarias insert: ${liqErr.message}`);

  return {
    mpUserId, cuentaNombre: seller.cuentaNombre,
    reportId: requested.id,
    fileName: ready.file_name,
    filasCsv: rows.length,
    filasInsertadasDetalle,
    netoIngreso,
    totalPayouts,
    cantidadPayouts: payoutRows.length,
    balanceFinal,
    alegrantIngresoId,
    withdrawals: withdrawalsOut,
    yaCerrado: false,
    warnings,
  };
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function mapRowToDetail(
  r: ReleaseRow,
  userId: string,
  mpUserId: number,
  fechaYmd: string,
  fileName: string,
) {
  return {
    user_id: userId,
    mp_user_id: mpUserId,
    fecha: fechaYmd,
    source_id: r.SOURCE_ID || null,
    external_reference: r.EXTERNAL_REFERENCE || null,
    record_type: r.RECORD_TYPE,
    description: r.DESCRIPTION,
    net_credit: parseAmount(r.NET_CREDIT_AMOUNT),
    net_debit: parseAmount(r.NET_DEBIT_AMOUNT),
    gross_amount: parseAmount(r.GROSS_AMOUNT),
    seller_amount: parseAmount(r.SELLER_AMOUNT),
    mp_fee_amount: parseAmount(r.MP_FEE_AMOUNT),
    financing_fee: parseAmount(r.FINANCING_FEE_AMOUNT),
    shipping_fee: parseAmount(r.SHIPPING_FEE_AMOUNT),
    taxes_amount: parseAmount(r.TAXES_AMOUNT),
    coupon_amount: parseAmount(r.COUPON_AMOUNT),
    installments: r.INSTALLMENTS ? Number(r.INSTALLMENTS) : null,
    payment_method: r.PAYMENT_METHOD || null,
    order_id: r.ORDER_ID || null,
    shipping_id: r.SHIPPING_ID || null,
    payout_cbu: (r.PAYOUT_BANK_ACCOUNT_NUMBER || "").trim() || null,
    balance_amount: r.BALANCE_AMOUNT ? parseAmount(r.BALANCE_AMOUNT) : null,
    raw: r,
    imported_batch: `cron-${fechaYmd}-${fileName.slice(-15)}`,
  };
}

async function findCuentaMp(
  supabase: SupabaseClient,
  userId: string,
  mpUserId: number,
): Promise<{ id: string; nombre: string } | null> {
  const { data } = await supabase
    .from("cuentas")
    .select("id, nombre")
    .eq("user_id", userId)
    .eq("mp_user_id", mpUserId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function findCuentaPorCbu(
  supabase: SupabaseClient,
  userId: string,
  cbu: string,
): Promise<{ id: string; nombre: string } | null> {
  const { data } = await supabase
    .from("cuentas")
    .select("id, nombre")
    .eq("user_id", userId)
    .eq("cbu", cbu)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

function formatDateAR(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}
