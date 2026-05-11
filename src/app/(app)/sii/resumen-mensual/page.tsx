"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { Loader2, Info, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";

type ResumenMes = {
  mes: string;
  facturas: number;
  boletas: number;
  liquidaciones: number;
  facturasExport: number;
  notasDebito: number;
  notasCredito: number;
  total: number;
  cantidad: number;
};

type ViewRow = {
  mes: string;
  facturas: number | string | null;
  boletas: number | string | null;
  liquidaciones: number | string | null;
  facturas_export: number | string | null;
  notas_debito: number | string | null;
  notas_credito: number | string | null;
  cantidad: number | null;
};

type SyncStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "ok"; periodos: number; ts: number }
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

export default function ResumenMensualSiiPage() {
  const [resumen, setResumen] = useState<ResumenMes[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatus>({ state: "idle" });

  const loadResumen = useCallback(async () => {
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("sii_resumen_mensual_v")
      .select("mes, facturas, boletas, liquidaciones, facturas_export, notas_debito, notas_credito, cantidad")
      .order("mes", { ascending: false });

    if (err) {
      setError(err.message);
      return;
    }
    const mapped: ResumenMes[] = (data ?? []).map((r) => {
      const v = r as ViewRow;
      const facturas = Number(v.facturas ?? 0);
      const boletas = Number(v.boletas ?? 0);
      const liquidaciones = Number(v.liquidaciones ?? 0);
      const facturasExport = Number(v.facturas_export ?? 0);
      const notasDebito = Number(v.notas_debito ?? 0);
      const notasCredito = Number(v.notas_credito ?? 0);
      return {
        mes: v.mes,
        facturas,
        boletas,
        liquidaciones,
        facturasExport,
        notasDebito,
        notasCredito,
        total: facturas + boletas + liquidaciones + facturasExport + notasDebito - notasCredito,
        cantidad: Number(v.cantidad ?? 0),
      };
    });
    setResumen(mapped);
  }, []);

  useEffect(() => {
    loadResumen();
  }, [loadResumen]);

  async function handleSync() {
    setSync({ state: "running" });
    try {
      const r = await fetch("/api/sii/sync-emitidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meses: 24 }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setSync({ state: "error", msg: j.error ?? `HTTP ${r.status}` });
        return;
      }
      setSync({ state: "ok", periodos: j.periodosSincronizados ?? 0, ts: Date.now() });
      await loadResumen();
    } catch (e) {
      setSync({ state: "error", msg: String(e) });
    }
  }

  const totales = useMemo(() => {
    if (!resumen)
      return { facturas: 0, boletas: 0, liquidaciones: 0, facturasExport: 0, notasDebito: 0, notasCredito: 0, total: 0, cantidad: 0 };
    return resumen.reduce(
      (acc, r) => ({
        facturas: acc.facturas + r.facturas,
        boletas: acc.boletas + r.boletas,
        liquidaciones: acc.liquidaciones + r.liquidaciones,
        facturasExport: acc.facturasExport + r.facturasExport,
        notasDebito: acc.notasDebito + r.notasDebito,
        notasCredito: acc.notasCredito + r.notasCredito,
        total: acc.total + r.total,
        cantidad: acc.cantidad + r.cantidad,
      }),
      { facturas: 0, boletas: 0, liquidaciones: 0, facturasExport: 0, notasDebito: 0, notasCredito: 0, total: 0, cantidad: 0 },
    );
  }, [resumen]);

  const subtotalesPorAnio = useMemo(() => {
    const map = new Map<string, typeof totales>();
    if (!resumen) return map;
    for (const r of resumen) {
      const anio = r.mes.slice(0, 4);
      let acc = map.get(anio);
      if (!acc) {
        acc = { facturas: 0, boletas: 0, liquidaciones: 0, facturasExport: 0, notasDebito: 0, notasCredito: 0, total: 0, cantidad: 0 };
        map.set(anio, acc);
      }
      acc.facturas += r.facturas;
      acc.boletas += r.boletas;
      acc.liquidaciones += r.liquidaciones;
      acc.facturasExport += r.facturasExport;
      acc.notasDebito += r.notasDebito;
      acc.notasCredito += r.notasCredito;
      acc.total += r.total;
      acc.cantidad += r.cantidad;
    }
    return map;
  }, [resumen, totales]);

  // Solo mostramos columna export si hay datos (la mayoría de PyMEs chilenas no exporta)
  const tieneExport = resumen?.some((r) => r.facturasExport > 0) ?? false;
  const tieneND = resumen?.some((r) => r.notasDebito > 0) ?? false;

  return (
    <div>
      <PageHeader
        title="SII — Resumen mensual"
        description="Total facturado por mes según el Registro de Compras y Ventas del SII Chile. Total = Facturas + Boletas + Liquidaciones-Factura + ND − Notas de Crédito."
        action={
          <button
            onClick={handleSync}
            disabled={sync.state === "running"}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            {sync.state === "running" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {sync.state === "running" ? "Actualizando…" : "Actualizar ahora"}
          </button>
        }
      />

      {sync.state === "ok" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 mb-4 flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {sync.periodos === 0
            ? "No se pudieron sincronizar periodos."
            : `${sync.periodos} periodo${sync.periodos === 1 ? "" : "s"} sincronizado${sync.periodos === 1 ? "" : "s"}.`}
        </div>
      )}

      {sync.state === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 mb-4 flex items-start gap-2 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>Error al sincronizar: {sync.msg}</div>
        </div>
      )}

      <div className="rounded-lg border border-[var(--border)] bg-[var(--accent)]/40 p-3 mb-4 flex items-start gap-2 text-sm text-slate-600">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-[var(--primary)]" />
        <div>
          Los datos se traen directamente del Registro de Compras y Ventas del SII usando tu
          certificado digital. Click en &quot;Actualizar ahora&quot; para sincronizar los últimos 24 meses.
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error cargando datos: {error}
        </div>
      )}

      {!resumen && !error && (
        <div className="flex items-center justify-center py-16 text-[var(--muted)]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando resumen…
        </div>
      )}

      {resumen && resumen.length === 0 && (
        <div className="rounded-lg border border-[var(--border)] p-8 text-center text-[var(--muted)]">
          No hay datos sincronizados aún. Hacé click en &quot;Actualizar ahora&quot; para traerlos del SII.
        </div>
      )}

      {resumen && resumen.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left font-medium px-4 py-2">Mes</th>
                <th className="text-right font-medium px-4 py-2">Facturas</th>
                <th className="text-right font-medium px-4 py-2">Boletas</th>
                <th className="text-right font-medium px-4 py-2">Liq.Factura</th>
                {tieneExport && <th className="text-right font-medium px-4 py-2">Facturas Export</th>}
                {tieneND && <th className="text-right font-medium px-4 py-2">Notas Débito</th>}
                <th className="text-right font-medium px-4 py-2">Notas Crédito</th>
                <th className="text-right font-medium px-4 py-2 bg-[var(--primary-soft)]">Total SII</th>
                <th className="text-right font-medium px-4 py-2">#</th>
              </tr>
            </thead>
            <tbody>
              {resumen.map((r, idx) => {
                const anio = r.mes.slice(0, 4);
                const proximo = resumen[idx + 1];
                const esUltimaDelAnio = !proximo || proximo.mes.slice(0, 4) !== anio;
                const sub = esUltimaDelAnio ? subtotalesPorAnio.get(anio) : undefined;
                return (
                  <Fragment key={r.mes}>
                    <tr className="border-t border-[var(--border)] hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium">{nombreMes(r.mes)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.facturas ? formatMoney(r.facturas, "CLP", "es-CL") : "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.boletas ? formatMoney(r.boletas, "CLP", "es-CL") : "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.liquidaciones ? formatMoney(r.liquidaciones, "CLP", "es-CL") : "—"}</td>
                      {tieneExport && <td className="px-4 py-2 text-right tabular-nums">{r.facturasExport ? formatMoney(r.facturasExport, "CLP", "es-CL") : "—"}</td>}
                      {tieneND && <td className="px-4 py-2 text-right tabular-nums">{r.notasDebito ? formatMoney(r.notasDebito, "CLP", "es-CL") : "—"}</td>}
                      <td className="px-4 py-2 text-right tabular-nums text-red-600">{r.notasCredito ? `− ${formatMoney(r.notasCredito, "CLP", "es-CL")}` : "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold bg-[var(--primary-soft)]/40">{formatMoney(r.total, "CLP", "es-CL")}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-[var(--muted)]">{r.cantidad}</td>
                    </tr>
                    {sub && (
                      <tr className="border-t-2 border-[var(--border)] bg-slate-100 font-medium">
                        <td className="px-4 py-2">Total {anio}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{sub.facturas ? formatMoney(sub.facturas, "CLP", "es-CL") : "—"}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{sub.boletas ? formatMoney(sub.boletas, "CLP", "es-CL") : "—"}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{sub.liquidaciones ? formatMoney(sub.liquidaciones, "CLP", "es-CL") : "—"}</td>
                        {tieneExport && <td className="px-4 py-2 text-right tabular-nums">{sub.facturasExport ? formatMoney(sub.facturasExport, "CLP", "es-CL") : "—"}</td>}
                        {tieneND && <td className="px-4 py-2 text-right tabular-nums">{sub.notasDebito ? formatMoney(sub.notasDebito, "CLP", "es-CL") : "—"}</td>}
                        <td className="px-4 py-2 text-right tabular-nums text-red-600">{sub.notasCredito ? `− ${formatMoney(sub.notasCredito, "CLP", "es-CL")}` : "—"}</td>
                        <td className="px-4 py-2 text-right tabular-nums bg-[var(--primary-soft)]/60">{formatMoney(sub.total, "CLP", "es-CL")}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-[var(--muted)]">{sub.cantidad}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold border-t-2 border-[var(--border)]">
              <tr>
                <td className="px-4 py-2">Total</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(totales.facturas, "CLP", "es-CL")}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(totales.boletas, "CLP", "es-CL")}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(totales.liquidaciones, "CLP", "es-CL")}</td>
                {tieneExport && <td className="px-4 py-2 text-right tabular-nums">{formatMoney(totales.facturasExport, "CLP", "es-CL")}</td>}
                {tieneND && <td className="px-4 py-2 text-right tabular-nums">{formatMoney(totales.notasDebito, "CLP", "es-CL")}</td>}
                <td className="px-4 py-2 text-right tabular-nums text-red-600">{totales.notasCredito ? `− ${formatMoney(totales.notasCredito, "CLP", "es-CL")}` : "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(totales.total, "CLP", "es-CL")}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--muted)]">{totales.cantidad}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
