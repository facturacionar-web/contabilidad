"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, Info, ExternalLink } from "lucide-react";
import Link from "next/link";

type Row = {
  mes: string;
  total_arca: number | string | null;
  total_ml: number | string | null;
  diferencia: number | string | null;
  diferencia_pct: number | string | null;
  cant_arca: number | null;
  cant_ml: number | null;
};

type ConciliacionMes = {
  mes: string;
  totalArca: number;
  totalMl: number;
  diferencia: number;
  diferenciaPct: number | null;
  cantArca: number;
  cantMl: number;
};

type SyncStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "ok"; ordenesNuevas: number }
  | { state: "error"; msg: string };

const TOLERANCIA_OK = 2; // % máximo aceptable

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
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatus>({ state: "idle" });

  const load = useCallback(async () => {
    const supabase = createClient();
    // Hacemos las 2 queries en paralelo y unimos en cliente. Es mucho más rápido
    // que pegarle a la VIEW arca_vs_ml_mensual_v (que hace FULL OUTER JOIN sobre
    // ~190k filas y suele timeout-ear en Supabase).
    const [arcaRes, mlRes] = await Promise.all([
      supabase
        .from("arca_resumen_mensual_v")
        .select("mes, facturas, notas_debito, notas_credito, cantidad"),
      supabase
        .from("ml_resumen_mensual_v")
        .select("mes, total_ml, cantidad"),
    ]);

    if (arcaRes.error) {
      setError(`ARCA: ${arcaRes.error.message}`);
      return;
    }
    if (mlRes.error) {
      setError(`ML: ${mlRes.error.message}`);
      return;
    }

    const arcaByMes = new Map<string, { totalArca: number; cantArca: number }>();
    for (const r of arcaRes.data ?? []) {
      const fac = Number((r as { facturas?: number | string | null }).facturas ?? 0);
      const nd = Number((r as { notas_debito?: number | string | null }).notas_debito ?? 0);
      const nc = Number((r as { notas_credito?: number | string | null }).notas_credito ?? 0);
      arcaByMes.set(r.mes, { totalArca: fac + nd - nc, cantArca: Number((r as { cantidad?: number | null }).cantidad ?? 0) });
    }

    const mlByMes = new Map<string, { totalMl: number; cantMl: number }>();
    for (const r of mlRes.data ?? []) {
      mlByMes.set(r.mes, {
        totalMl: Number((r as { total_ml?: number | string | null }).total_ml ?? 0),
        cantMl: Number((r as { cantidad?: number | null }).cantidad ?? 0),
      });
    }

    const meses = new Set<string>([...arcaByMes.keys(), ...mlByMes.keys()]);
    const merged: ConciliacionMes[] = [...meses]
      .sort((a, b) => b.localeCompare(a))
      .map((mes) => {
        const a = arcaByMes.get(mes) ?? { totalArca: 0, cantArca: 0 };
        const m = mlByMes.get(mes) ?? { totalMl: 0, cantMl: 0 };
        const diferencia = a.totalArca - m.totalMl;
        const diferenciaPct = m.totalMl === 0 ? null : (diferencia / m.totalMl) * 100;
        return {
          mes,
          totalArca: a.totalArca,
          totalMl: m.totalMl,
          diferencia,
          diferenciaPct,
          cantArca: a.cantArca,
          cantMl: m.cantMl,
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
    if (!data) return { arca: 0, ml: 0, diff: 0 };
    return data.reduce(
      (acc, r) => ({
        arca: acc.arca + r.totalArca,
        ml: acc.ml + r.totalMl,
        diff: acc.diff + r.diferencia,
      }),
      { arca: 0, ml: 0, diff: 0 },
    );
  }, [data]);

  const totalDiffPct = totales.ml === 0 ? null : (totales.diff / totales.ml) * 100;

  return (
    <div>
      <PageHeader
        title="Conciliación ARCA vs Mercado Libre"
        description="Comparación mes a mes. Total ARCA = Facturas + ND − NC. Total ML = total_amount de órdenes pagadas (incluye envío que pagó el comprador)."
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
          Tolerancia objetivo: <strong>±{TOLERANCIA_OK}%</strong>. Verde = dentro de tolerancia; amarillo = ±2-5% (revisar);
          rojo = &gt;5% (revisar urgente).
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
        <div className="rounded-lg border border-[var(--border)] bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left font-medium px-4 py-2">Mes</th>
                <th className="text-right font-medium px-4 py-2">Total ARCA</th>
                <th className="text-right font-medium px-4 py-2">Total ML</th>
                <th className="text-right font-medium px-4 py-2">Diferencia</th>
                <th className="text-right font-medium px-4 py-2">Diferencia %</th>
                <th className="text-right font-medium px-4 py-2"># ARCA / ML</th>
                <th className="text-right font-medium px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.mes} className="border-t border-[var(--border)] hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium">{nombreMes(r.mes)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatMoney(r.totalArca, "ARS")}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatMoney(r.totalMl, "ARS")}
                  </td>
                  <td className={`px-4 py-2 text-right tabular-nums font-medium ${classByDiff(r.diferenciaPct)}`}>
                    {r.diferencia >= 0 ? "+" : ""}
                    {formatMoney(r.diferencia, "ARS")}
                  </td>
                  <td className={`px-4 py-2 text-right tabular-nums font-semibold ${classByDiff(r.diferenciaPct)}`}>
                    {r.diferenciaPct === null ? "—" : `${r.diferenciaPct >= 0 ? "+" : ""}${r.diferenciaPct.toFixed(2)}%`}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--muted)]">
                    {r.cantArca.toLocaleString("es-AR")} / {r.cantMl.toLocaleString("es-AR")}
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
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold border-t-2 border-[var(--border)]">
              <tr>
                <td className="px-4 py-2">Total</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(totales.arca, "ARS")}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(totales.ml, "ARS")}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${classByDiff(totalDiffPct)}`}>
                  {totales.diff >= 0 ? "+" : ""}
                  {formatMoney(totales.diff, "ARS")}
                </td>
                <td className={`px-4 py-2 text-right tabular-nums ${classByDiff(totalDiffPct)}`}>
                  {totalDiffPct === null ? "—" : `${totalDiffPct >= 0 ? "+" : ""}${totalDiffPct.toFixed(2)}%`}
                </td>
                <td className="px-4 py-2"></td>
                <td className="px-4 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
