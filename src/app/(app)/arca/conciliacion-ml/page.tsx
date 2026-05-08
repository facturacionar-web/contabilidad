"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, Info, ExternalLink } from "lucide-react";
import Link from "next/link";

type Seller = { seller_id: number; seller_label: string };

type ConciliacionMes = {
  mes: string;
  totalArca: number;
  totalMl: number;            // suma de los sellers
  porSeller: Record<string, number>;  // seller_id → total
  diferencia: number;
  diferenciaPct: number | null;
  cantArca: number;
  cantMlPorSeller: Record<string, number>;
};

type SyncStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "ok"; ordenesNuevas: number }
  | { state: "error"; msg: string };

const TOLERANCIA_OK = 2;

function nombreMes(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  const idx = Number(m) - 1;
  return `${meses[idx] ?? m} ${y}`;
}

function classByDiff(pct: number | null): string {
  if (pct === null) return "text-[var(--muted)]";
  const abs = Math.abs(pct);
  if (abs <= TOLERANCIA_OK) return "text-emerald-600";
  if (abs <= 5) return "text-amber-600";
  return "text-red-600";
}

export default function ConciliacionMlPage() {
  const [data, setData] = useState<ConciliacionMes[] | null>(null);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatus>({ state: "idle" });

  const load = useCallback(async () => {
    const supabase = createClient();

    const [arcaRes, mlSellerRes, sellersRes] = await Promise.all([
      supabase
        .from("arca_resumen_mensual_v")
        .select("mes, facturas, notas_debito, notas_credito, cantidad"),
      supabase
        .from("ml_resumen_mensual_seller_v")
        .select("mes, ml_seller_id, seller_label, total_ml, cantidad"),
      supabase
        .from("ml_sellers_v")
        .select("seller_id, seller_label"),
    ]);

    if (arcaRes.error) { setError(`ARCA: ${arcaRes.error.message}`); return; }
    if (mlSellerRes.error) { setError(`ML: ${mlSellerRes.error.message}`); return; }
    if (sellersRes.error) { setError(`Sellers: ${sellersRes.error.message}`); return; }

    setSellers((sellersRes.data ?? []) as Seller[]);

    // ARCA: total por mes
    const arcaByMes = new Map<string, { totalArca: number; cantArca: number }>();
    for (const r of arcaRes.data ?? []) {
      const fac = Number((r as { facturas?: number | string | null }).facturas ?? 0);
      const nd = Number((r as { notas_debito?: number | string | null }).notas_debito ?? 0);
      const nc = Number((r as { notas_credito?: number | string | null }).notas_credito ?? 0);
      arcaByMes.set(r.mes, {
        totalArca: fac + nd - nc,
        cantArca: Number((r as { cantidad?: number | null }).cantidad ?? 0),
      });
    }

    // ML: por mes y seller
    const mlByMes = new Map<string, { totalMl: number; porSeller: Record<string, number>; cantMlPorSeller: Record<string, number> }>();
    for (const r of mlSellerRes.data ?? []) {
      const row = r as { mes: string; ml_seller_id: number | string; total_ml: number | string | null; cantidad: number | null };
      const sellerId = String(row.ml_seller_id);
      const monto = Number(row.total_ml ?? 0);
      const cant = Number(row.cantidad ?? 0);
      let acc = mlByMes.get(row.mes);
      if (!acc) {
        acc = { totalMl: 0, porSeller: {}, cantMlPorSeller: {} };
        mlByMes.set(row.mes, acc);
      }
      acc.totalMl += monto;
      acc.porSeller[sellerId] = monto;
      acc.cantMlPorSeller[sellerId] = cant;
    }

    const meses = new Set<string>([...arcaByMes.keys(), ...mlByMes.keys()]);
    const merged: ConciliacionMes[] = [...meses]
      .sort((a, b) => b.localeCompare(a))
      .map((mes) => {
        const a = arcaByMes.get(mes) ?? { totalArca: 0, cantArca: 0 };
        const m = mlByMes.get(mes) ?? { totalMl: 0, porSeller: {}, cantMlPorSeller: {} };
        const diferencia = a.totalArca - m.totalMl;
        const diferenciaPct = m.totalMl === 0 ? null : (diferencia / m.totalMl) * 100;
        return {
          mes,
          totalArca: a.totalArca,
          totalMl: m.totalMl,
          porSeller: m.porSeller,
          diferencia,
          diferenciaPct,
          cantArca: a.cantArca,
          cantMlPorSeller: m.cantMlPorSeller,
        };
      });
    setData(merged);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSync() {
    setSync({ state: "running" });
    try {
      const r = await fetch("/api/ml/sync-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxPorTanda: 500 }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setSync({ state: "error", msg: j.error ?? `HTTP ${r.status}` });
        return;
      }
      setSync({ state: "ok", ordenesNuevas: j.ordenesNuevas ?? 0 });
      await load();
    } catch (e) {
      setSync({ state: "error", msg: String(e) });
    }
  }

  const totales = useMemo(() => {
    if (!data) return { arca: 0, ml: 0, diff: 0, porSeller: {} as Record<string, number> };
    const acc = { arca: 0, ml: 0, diff: 0, porSeller: {} as Record<string, number> };
    for (const r of data) {
      acc.arca += r.totalArca;
      acc.ml += r.totalMl;
      acc.diff += r.diferencia;
      for (const [k, v] of Object.entries(r.porSeller)) {
        acc.porSeller[k] = (acc.porSeller[k] ?? 0) + v;
      }
    }
    return acc;
  }, [data]);

  const totalDiffPct = totales.ml === 0 ? null : (totales.diff / totales.ml) * 100;

  const subtotalesPorAnio = useMemo(() => {
    type Sub = { arca: number; ml: number; diff: number; porSeller: Record<string, number> };
    const map = new Map<string, Sub>();
    if (!data) return map;
    for (const r of data) {
      const anio = r.mes.slice(0, 4);
      let acc = map.get(anio);
      if (!acc) {
        acc = { arca: 0, ml: 0, diff: 0, porSeller: {} };
        map.set(anio, acc);
      }
      acc.arca += r.totalArca;
      acc.ml += r.totalMl;
      acc.diff += r.diferencia;
      for (const [k, v] of Object.entries(r.porSeller)) {
        acc.porSeller[k] = (acc.porSeller[k] ?? 0) + v;
      }
    }
    return map;
  }, [data]);

  return (
    <div>
      <PageHeader
        title="Conciliación ARCA vs Mercado Libre"
        description="Comparación mes a mes. Total ARCA = Facturas + ND − NC. Total ML = paid_amount de órdenes pagadas (incluye envío del comprador), agrupado por fecha de cierre."
        action={
          <button
            onClick={handleSync}
            disabled={sync.state === "running"}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            {sync.state === "running" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {sync.state === "running" ? "Sincronizando ML…" : "Sincronizar ML"}
          </button>
        }
      />

      {sync.state === "ok" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 mb-4 flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {sync.ordenesNuevas === 0
            ? "ML al día. No hay órdenes nuevas."
            : `${sync.ordenesNuevas} orden${sync.ordenesNuevas === 1 ? "" : "es"} nueva${sync.ordenesNuevas === 1 ? "" : "s"} de ML sincronizada${sync.ordenesNuevas === 1 ? "" : "s"}.`}
        </div>
      )}

      {sync.state === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 mb-4 flex items-start gap-2 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>Error sincronizando ML: {sync.msg}</div>
        </div>
      )}

      <div className="rounded-lg border border-[var(--border)] bg-[var(--accent)]/40 p-3 mb-4 flex items-start gap-2 text-sm text-slate-600">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-[var(--primary)]" />
        <div>
          Tolerancia objetivo: <strong>±{TOLERANCIA_OK}%</strong>. Verde = dentro de tolerancia; amarillo = ±2-5%;
          rojo = &gt;5%.
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error cargando datos: {error}
        </div>
      )}

      {!data && !error && (
        <div className="flex items-center justify-center py-16 text-[var(--muted)]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando conciliación…
        </div>
      )}

      {data && data.length === 0 && (
        <div className="rounded-lg border border-[var(--border)] p-8 text-center text-[var(--muted)]">
          Sin datos para conciliar todavía.
        </div>
      )}

      {data && data.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left font-medium px-4 py-2">Mes</th>
                <th className="text-right font-medium px-4 py-2">Total ARCA</th>
                {sellers.map((s) => (
                  <th key={s.seller_id} className="text-right font-medium px-4 py-2 text-xs">
                    {s.seller_label}
                  </th>
                ))}
                <th className="text-right font-medium px-4 py-2">Total ML</th>
                <th className="text-right font-medium px-4 py-2">Diferencia</th>
                <th className="text-right font-medium px-4 py-2">%</th>
                <th className="text-right font-medium px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((r, idx) => {
                const anio = r.mes.slice(0, 4);
                const proximo = data[idx + 1];
                const esUltimaDelAnio = !proximo || proximo.mes.slice(0, 4) !== anio;
                const sub = esUltimaDelAnio ? subtotalesPorAnio.get(anio) : undefined;
                const subPct = sub && sub.ml !== 0 ? (sub.diff / sub.ml) * 100 : null;
                return (
                  <Fragment key={r.mes}>
                    <tr className="border-t border-[var(--border)] hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium">{nombreMes(r.mes)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatMoney(r.totalArca, "ARS")}
                      </td>
                      {sellers.map((s) => (
                        <td key={s.seller_id} className="px-4 py-2 text-right tabular-nums text-[var(--muted)]">
                          {r.porSeller[String(s.seller_id)]
                            ? formatMoney(r.porSeller[String(s.seller_id)], "ARS")
                            : "—"}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">
                        {formatMoney(r.totalMl, "ARS")}
                      </td>
                      <td className={`px-4 py-2 text-right tabular-nums font-medium ${classByDiff(r.diferenciaPct)}`}>
                        {r.diferencia >= 0 ? "+" : ""}
                        {formatMoney(r.diferencia, "ARS")}
                      </td>
                      <td className={`px-4 py-2 text-right tabular-nums font-semibold ${classByDiff(r.diferenciaPct)}`}>
                        {r.diferenciaPct === null ? "—" : `${r.diferenciaPct >= 0 ? "+" : ""}${r.diferenciaPct.toFixed(2)}%`}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Link
                          href={`/arca/comprobantes?desde=${r.mes}-01&hasta=${r.mes}-31`}
                          className="inline-flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"
                        >
                          Ver ARCA <ExternalLink className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                    {sub && (
                      <tr className="border-t-2 border-[var(--border)] bg-slate-100 font-medium">
                        <td className="px-4 py-2">Total {anio}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatMoney(sub.arca, "ARS")}</td>
                        {sellers.map((s) => (
                          <td key={s.seller_id} className="px-4 py-2 text-right tabular-nums">
                            {sub.porSeller[String(s.seller_id)]
                              ? formatMoney(sub.porSeller[String(s.seller_id)], "ARS")
                              : "—"}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right tabular-nums">{formatMoney(sub.ml, "ARS")}</td>
                        <td className={`px-4 py-2 text-right tabular-nums ${classByDiff(subPct)}`}>
                          {sub.diff >= 0 ? "+" : ""}
                          {formatMoney(sub.diff, "ARS")}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums ${classByDiff(subPct)}`}>
                          {subPct === null ? "—" : `${subPct >= 0 ? "+" : ""}${subPct.toFixed(2)}%`}
                        </td>
                        <td className="px-4 py-2"></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold border-t-2 border-[var(--border)]">
              <tr>
                <td className="px-4 py-2">Total</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(totales.arca, "ARS")}</td>
                {sellers.map((s) => (
                  <td key={s.seller_id} className="px-4 py-2 text-right tabular-nums text-[var(--muted)]">
                    {totales.porSeller[String(s.seller_id)]
                      ? formatMoney(totales.porSeller[String(s.seller_id)], "ARS")
                      : "—"}
                  </td>
                ))}
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(totales.ml, "ARS")}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${classByDiff(totalDiffPct)}`}>
                  {totales.diff >= 0 ? "+" : ""}
                  {formatMoney(totales.diff, "ARS")}
                </td>
                <td className={`px-4 py-2 text-right tabular-nums ${classByDiff(totalDiffPct)}`}>
                  {totalDiffPct === null ? "—" : `${totalDiffPct >= 0 ? "+" : ""}${totalDiffPct.toFixed(2)}%`}
                </td>
                <td className="px-4 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
