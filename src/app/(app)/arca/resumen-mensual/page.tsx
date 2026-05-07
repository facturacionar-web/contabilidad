"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { Loader2, ExternalLink, Info, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  TIPO_FACTURAS,
  TIPO_NOTAS_DEBITO,
  TIPO_NOTAS_CREDITO,
  TIPOS_RELEVANTES,
} from "@/lib/arca/tipos-cbte";

type Row = {
  fecha_cbte: string;
  cbte_tipo: number;
  imp_total: number;
};

type ResumenMes = {
  mes: string;            // "YYYY-MM"
  facturas: number;
  notasDebito: number;
  notasCredito: number;
  totalArca: number;      // facturas + ND - NC
  cantidad: number;
};

function mesDe(fecha: string): string {
  return fecha.slice(0, 7); // YYYY-MM-DD → YYYY-MM
}

function nombreMes(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  const idx = Number(m) - 1;
  return `${meses[idx] ?? m} ${y}`;
}

type SyncStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "ok"; nuevos: number; ts: number }
  | { state: "error"; msg: string };

export default function ResumenMensualArcaPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatus>({ state: "idle" });

  const loadRows = useCallback(async () => {
    const supabase = createClient();
    const all: Row[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error: err } = await supabase
        .from("arca_comprobantes_emitidos")
        .select("fecha_cbte, cbte_tipo, imp_total")
        .in("cbte_tipo", TIPOS_RELEVANTES as unknown as number[])
        .order("fecha_cbte", { ascending: false })
        .range(from, from + pageSize - 1);

      if (err) {
        setError(err.message);
        return;
      }
      if (!data || data.length === 0) break;
      all.push(...(data as Row[]));
      if (data.length < pageSize) break;
      from += pageSize;
    }
    setRows(all);
  }, []);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  async function handleSync() {
    setSync({ state: "running" });
    try {
      const r = await fetch("/api/arca/sync-emitidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxPorPunto: 200 }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setSync({ state: "error", msg: j.error ?? `HTTP ${r.status}` });
        return;
      }
      setSync({ state: "ok", nuevos: j.comprobantesNuevos ?? 0, ts: Date.now() });
      await loadRows();
    } catch (e) {
      setSync({ state: "error", msg: String(e) });
    }
  }

  const resumen: ResumenMes[] = useMemo(() => {
    if (!rows) return [];
    const map = new Map<string, ResumenMes>();
    for (const r of rows) {
      const mes = mesDe(r.fecha_cbte);
      if (!map.has(mes)) {
        map.set(mes, {
          mes,
          facturas: 0,
          notasDebito: 0,
          notasCredito: 0,
          totalArca: 0,
          cantidad: 0,
        });
      }
      const acc = map.get(mes)!;
      const monto = Number(r.imp_total) || 0;
      acc.cantidad += 1;
      if ((TIPO_FACTURAS as readonly number[]).includes(r.cbte_tipo)) {
        acc.facturas += monto;
      } else if ((TIPO_NOTAS_DEBITO as readonly number[]).includes(r.cbte_tipo)) {
        acc.notasDebito += monto;
      } else if ((TIPO_NOTAS_CREDITO as readonly number[]).includes(r.cbte_tipo)) {
        acc.notasCredito += monto;
      }
    }
    for (const acc of map.values()) {
      acc.totalArca = acc.facturas + acc.notasDebito - acc.notasCredito;
    }
    return [...map.values()].sort((a, b) => b.mes.localeCompare(a.mes));
  }, [rows]);

  const totales = useMemo(() => {
    return resumen.reduce(
      (acc, r) => ({
        facturas: acc.facturas + r.facturas,
        notasDebito: acc.notasDebito + r.notasDebito,
        notasCredito: acc.notasCredito + r.notasCredito,
        totalArca: acc.totalArca + r.totalArca,
        cantidad: acc.cantidad + r.cantidad,
      }),
      { facturas: 0, notasDebito: 0, notasCredito: 0, totalArca: 0, cantidad: 0 },
    );
  }, [resumen]);

  return (
    <div>
      <PageHeader
        title="ARCA — Resumen mensual"
        description="Total facturado por mes según comprobantes emitidos en ARCA. Total = Facturas + Notas de Débito − Notas de Crédito."
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
          {sync.nuevos === 0
            ? "Ya estás al día. No hay comprobantes nuevos."
            : `${sync.nuevos} comprobante${sync.nuevos === 1 ? "" : "s"} nuevo${sync.nuevos === 1 ? "" : "s"} sincronizado${sync.nuevos === 1 ? "" : "s"}.`}
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
          Sincronización automática cada 5 horas. Para forzar una actualización
          inmediata, usá el botón de arriba. La conciliación con Mercado Libre
          se sumará cuando esté disponible la otra base de datos (tolerancia
          objetivo: ±1-2%).
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error cargando datos: {error}
        </div>
      )}

      {!rows && !error && (
        <div className="flex items-center justify-center py-16 text-[var(--muted)]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando comprobantes…
        </div>
      )}

      {rows && resumen.length === 0 && (
        <div className="rounded-lg border border-[var(--border)] p-8 text-center text-[var(--muted)]">
          No hay comprobantes para mostrar.
        </div>
      )}

      {resumen.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left font-medium px-4 py-2">Mes</th>
                <th className="text-right font-medium px-4 py-2">Facturas</th>
                <th className="text-right font-medium px-4 py-2">Notas Débito</th>
                <th className="text-right font-medium px-4 py-2">Notas Crédito</th>
                <th className="text-right font-medium px-4 py-2 bg-[var(--primary-soft)]">
                  Total ARCA
                </th>
                <th className="text-right font-medium px-4 py-2">#</th>
                <th className="text-right font-medium px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {resumen.map((r) => (
                <tr key={r.mes} className="border-t border-[var(--border)] hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium">{nombreMes(r.mes)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatMoney(r.facturas, "ARS")}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.notasDebito ? formatMoney(r.notasDebito, "ARS") : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-red-600">
                    {r.notasCredito ? `− ${formatMoney(r.notasCredito, "ARS")}` : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold bg-[var(--primary-soft)]/40">
                    {formatMoney(r.totalArca, "ARS")}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--muted)]">
                    {r.cantidad}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/arca/comprobantes?desde=${r.mes}-01&hasta=${r.mes}-31`}
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
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatMoney(totales.facturas, "ARS")}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {totales.notasDebito ? formatMoney(totales.notasDebito, "ARS") : "—"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-red-600">
                  {totales.notasCredito ? `− ${formatMoney(totales.notasCredito, "ARS")}` : "—"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatMoney(totales.totalArca, "ARS")}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--muted)]">
                  {totales.cantidad}
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
