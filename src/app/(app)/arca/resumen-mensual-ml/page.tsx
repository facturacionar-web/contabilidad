"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { Loader2, ExternalLink, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";

type Seller = { seller_id: number; seller_label: string };

type ResumenMes = {
  mes: string;
  totalMl: number;
  porSeller: Record<string, number>;
  cantidad: number;
  cantPorSeller: Record<string, number>;
};

type SyncStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "ok"; ordenesNuevas: number }
  | { state: "error"; msg: string };

function nombreMes(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  const idx = Number(m) - 1;
  return `${meses[idx] ?? m} ${y}`;
}

export default function ResumenMensualMlPage() {
  const [data, setData] = useState<ResumenMes[] | null>(null);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatus>({ state: "idle" });

  const load = useCallback(async () => {
    const supabase = createClient();
    const [mlRes, sellersRes] = await Promise.all([
      supabase
        .from("ml_resumen_mensual_seller_v")
        .select("mes, ml_seller_id, seller_label, total_ml, cantidad"),
      supabase
        .from("ml_sellers_v")
        .select("seller_id, seller_label"),
    ]);

    if (mlRes.error) { setError(`ML: ${mlRes.error.message}`); return; }
    if (sellersRes.error) { setError(`Sellers: ${sellersRes.error.message}`); return; }

    setSellers((sellersRes.data ?? []) as Seller[]);

    const byMes = new Map<string, ResumenMes>();
    for (const r of mlRes.data ?? []) {
      const row = r as { mes: string; ml_seller_id: number | string; total_ml: number | string | null; cantidad: number | null };
      const sellerId = String(row.ml_seller_id);
      const monto = Number(row.total_ml ?? 0);
      const cant = Number(row.cantidad ?? 0);
      let acc = byMes.get(row.mes);
      if (!acc) {
        acc = { mes: row.mes, totalMl: 0, porSeller: {}, cantidad: 0, cantPorSeller: {} };
        byMes.set(row.mes, acc);
      }
      acc.totalMl += monto;
      acc.porSeller[sellerId] = monto;
      acc.cantidad += cant;
      acc.cantPorSeller[sellerId] = cant;
    }

    const sorted = [...byMes.values()].sort((a, b) => b.mes.localeCompare(a.mes));
    setData(sorted);
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
    if (!data) return { totalMl: 0, porSeller: {} as Record<string, number>, cantidad: 0 };
    const acc = { totalMl: 0, porSeller: {} as Record<string, number>, cantidad: 0 };
    for (const r of data) {
      acc.totalMl += r.totalMl;
      acc.cantidad += r.cantidad;
      for (const [k, v] of Object.entries(r.porSeller)) {
        acc.porSeller[k] = (acc.porSeller[k] ?? 0) + v;
      }
    }
    return acc;
  }, [data]);

  return (
    <div>
      <PageHeader
        title="Mercado Libre — Resumen mensual"
        description="Total de ventas por mes según órdenes pagadas en ML, agrupadas por fecha de cierre. Total = sum(paid_amount) — incluye envío que pagó el comprador."
        action={
          <button
            onClick={handleSync}
            disabled={sync.state === "running"}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            {sync.state === "running" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {sync.state === "running" ? "Actualizando…" : "Actualizar ahora"}
          </button>
        }
      />

      {sync.state === "ok" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 mb-4 flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {sync.ordenesNuevas === 0
            ? "Al día. No hay órdenes nuevas."
            : `${sync.ordenesNuevas} orden${sync.ordenesNuevas === 1 ? "" : "es"} nueva${sync.ordenesNuevas === 1 ? "" : "s"} sincronizada${sync.ordenesNuevas === 1 ? "" : "s"}.`}
        </div>
      )}

      {sync.state === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 mb-4 flex items-start gap-2 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>Error al sincronizar: {sync.msg}</div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error cargando datos: {error}
        </div>
      )}

      {!data && !error && (
        <div className="flex items-center justify-center py-16 text-[var(--muted)]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando resumen…
        </div>
      )}

      {data && data.length === 0 && (
        <div className="rounded-lg border border-[var(--border)] p-8 text-center text-[var(--muted)]">
          Sin ventas para mostrar.
        </div>
      )}

      {data && data.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left font-medium px-4 py-2">Mes</th>
                {sellers.map((s) => (
                  <th key={s.seller_id} className="text-right font-medium px-4 py-2 text-xs">
                    {s.seller_label}
                  </th>
                ))}
                <th className="text-right font-medium px-4 py-2 bg-[var(--primary-soft)]">Total ML</th>
                <th className="text-right font-medium px-4 py-2">#</th>
                <th className="text-right font-medium px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.mes} className="border-t border-[var(--border)] hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium">{nombreMes(r.mes)}</td>
                  {sellers.map((s) => (
                    <td key={s.seller_id} className="px-4 py-2 text-right tabular-nums text-[var(--muted)]">
                      {r.porSeller[String(s.seller_id)]
                        ? formatMoney(r.porSeller[String(s.seller_id)], "ARS")
                        : "—"}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right tabular-nums font-semibold bg-[var(--primary-soft)]/40">
                    {formatMoney(r.totalMl, "ARS")}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--muted)]">
                    {r.cantidad.toLocaleString("es-AR")}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/arca/ventas-ml?desde=${r.mes}-01&hasta=${r.mes}-31`}
                      className="inline-flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"
                    >
                      Ver detalle <ExternalLink className="w-3 h-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold border-t-2 border-[var(--border)]">
              <tr>
                <td className="px-4 py-2">Total</td>
                {sellers.map((s) => (
                  <td key={s.seller_id} className="px-4 py-2 text-right tabular-nums text-[var(--muted)]">
                    {totales.porSeller[String(s.seller_id)]
                      ? formatMoney(totales.porSeller[String(s.seller_id)], "ARS")
                      : "—"}
                  </td>
                ))}
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(totales.totalMl, "ARS")}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--muted)]">
                  {totales.cantidad.toLocaleString("es-AR")}
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
