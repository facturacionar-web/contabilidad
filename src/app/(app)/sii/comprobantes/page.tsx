"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { Loader2, Download, RefreshCw, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import {
  TIPO_FACTURAS,
  TIPO_NOTAS_DEBITO,
  TIPO_NOTAS_CREDITO,
  TIPO_LIQUIDACIONES,
  TIPOS_CON_DETALLE,
  tipoLabel,
} from "@/lib/sii/tipos-dte";
import * as XLSX from "xlsx";

type Cbte = {
  id: number;
  fecha_doc: string | null;
  cod_tipo_doc: number;
  folio: number;
  rut_receptor: number | null;
  dv_receptor: string | null;
  razon_social_receptor: string | null;
  monto_exento: number;
  monto_neto: number;
  monto_iva: number;
  monto_total: number;
  anulado: string | null;
};

type Filtro = "todos" | "facturas" | "liquidaciones" | "notas_credito" | "notas_debito";

type SyncStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "ok"; comprobantes: number }
  | { state: "error"; msg: string };

const PAGE_SIZE = 50;
const EXPORT_CHUNK = 1000;
const EXPORT_HARD_LIMIT = 100000;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function tiposPorFiltro(f: Filtro): readonly number[] {
  if (f === "facturas") return TIPO_FACTURAS;
  if (f === "liquidaciones") return TIPO_LIQUIDACIONES;
  if (f === "notas_debito") return TIPO_NOTAS_DEBITO;
  if (f === "notas_credito") return TIPO_NOTAS_CREDITO;
  return TIPOS_CON_DETALLE;
}

function formatRutReceptor(rut: number | null, dv: string | null): string {
  if (rut == null) return "—";
  return `${rut.toLocaleString("es-CL").replace(/,/g, ".")}-${dv ?? ""}`;
}

export default function SiiComprobantesPage() {
  const params = useSearchParams();
  const initialDesde = params.get("desde") ?? "2026-01-01";
  const initialHasta = params.get("hasta") ?? todayISO();

  const [desde, setDesde] = useState(initialDesde);
  const [hasta, setHasta] = useState(initialHasta);
  const [tipoFiltro, setTipoFiltro] = useState<Filtro>("todos");
  const [rutFiltro, setRutFiltro] = useState("");
  const [rutAplicado, setRutAplicado] = useState("");

  const [rows, setRows] = useState<Cbte[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  const [sync, setSync] = useState<SyncStatus>({ state: "idle" });
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [desde, hasta, tipoFiltro, rutAplicado]);

  useEffect(() => {
    const id = setTimeout(() => setRutAplicado(rutFiltro.trim()), 400);
    return () => clearTimeout(id);
  }, [rutFiltro]);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const tipos = tiposPorFiltro(tipoFiltro);
    let query = supabase
      .from("sii_comprobantes_emitidos")
      .select(
        "id, fecha_doc, cod_tipo_doc, folio, rut_receptor, dv_receptor, razon_social_receptor, monto_exento, monto_neto, monto_iva, monto_total, anulado",
        { count: "exact" },
      )
      .in("cod_tipo_doc", tipos as unknown as number[])
      .gte("fecha_doc", desde)
      .lte("fecha_doc", hasta)
      .order("fecha_doc", { ascending: false })
      .order("folio", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (rutAplicado) {
      const onlyDigits = rutAplicado.replace(/\D/g, "");
      if (onlyDigits) query = query.eq("rut_receptor", Number(onlyDigits));
    }

    const { data, error: err, count } = await query;
    if (err) {
      setError(err.message);
      setRows([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as Cbte[]);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [desde, hasta, tipoFiltro, rutAplicado, page]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  async function handleSync() {
    setSync({ state: "running" });
    try {
      const r = await fetch("/api/sii/sync-emitidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detalle: true, desde: desde.replace(/-/g, "").slice(0, 6) }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setSync({ state: "error", msg: j.error ?? `HTTP ${r.status}` });
        return;
      }
      setSync({ state: "ok", comprobantes: j.comprobantesUpsert ?? 0 });
      await loadPage();
    } catch (e) {
      setSync({ state: "error", msg: String(e) });
    }
  }

  async function exportExcel() {
    setExporting(true);
    setExportProgress(0);
    try {
      const supabase = createClient();
      const tipos = tiposPorFiltro(tipoFiltro);
      const all: Array<Record<string, unknown>> = [];
      let from = 0;
      while (from < EXPORT_HARD_LIMIT) {
        let query = supabase
          .from("sii_comprobantes_emitidos")
          .select("fecha_doc, cod_tipo_doc, folio, rut_receptor, dv_receptor, razon_social_receptor, monto_exento, monto_neto, monto_iva, monto_total, anulado")
          .in("cod_tipo_doc", tipos as unknown as number[])
          .gte("fecha_doc", desde)
          .lte("fecha_doc", hasta)
          .order("fecha_doc", { ascending: false })
          .order("folio", { ascending: false })
          .range(from, from + EXPORT_CHUNK - 1);

        if (rutAplicado) {
          const onlyDigits = rutAplicado.replace(/\D/g, "");
          if (onlyDigits) query = query.eq("rut_receptor", Number(onlyDigits));
        }

        const { data, error: err } = await query;
        if (err) {
          setError(err.message);
          return;
        }
        if (!data || data.length === 0) break;
        all.push(...(data as Array<Record<string, unknown>>));
        setExportProgress(all.length);
        if (data.length < EXPORT_CHUNK) break;
        from += EXPORT_CHUNK;
      }

      const exportData = all.map((r) => ({
        Fecha: r.fecha_doc,
        Tipo: tipoLabel(r.cod_tipo_doc as number),
        Folio: r.folio,
        "RUT receptor":
          r.rut_receptor != null ? `${r.rut_receptor}-${r.dv_receptor ?? ""}` : "",
        "Razón Social": r.razon_social_receptor ?? "",
        Exento: r.monto_exento ?? 0,
        Neto: r.monto_neto ?? 0,
        IVA: r.monto_iva ?? 0,
        Total: r.monto_total ?? 0,
        Anulado: r.anulado ?? "",
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "SII");
      XLSX.writeFile(wb, `sii-comprobantes-${desde}-a-${hasta}.xlsx`);
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  }

  const totalPaginas = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="SII — Comprobantes emitidos"
        description="Detalle factura por factura desde el Registro de Compras y Ventas del SII Chile. Las boletas no aparecen acá porque el SII no las expone individualmente (solo en el resumen mensual)."
        action={
          <div className="flex gap-2">
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
              {sync.state === "running" ? "Actualizando…" : "Actualizar"}
            </button>
            <button
              onClick={exportExcel}
              disabled={exporting || totalCount === 0}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--border)] hover:bg-slate-50 disabled:opacity-50"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {exporting
                ? exportProgress > 0
                  ? `${exportProgress.toLocaleString("es-CL")}/${totalCount.toLocaleString("es-CL")}…`
                  : "Generando…"
                : "Exportar Excel"}
            </button>
          </div>
        }
      />

      {sync.state === "ok" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 mb-4 flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {`${sync.comprobantes.toLocaleString("es-CL")} comprobante${sync.comprobantes === 1 ? "" : "s"} actualizado${sync.comprobantes === 1 ? "" : "s"}.`}
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
          Incluye Facturas (33, 34), Liquidaciones-Factura (43), Notas de Débito (56) y Notas de Crédito (61).
          Las boletas (39, 41) solo aparecen agregadas en <a href="/sii/resumen-mensual" className="text-[var(--primary)] underline">Resumen mensual</a> — el SII no las expone individualmente por API.
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-white p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="input" />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="input" />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">Tipo</label>
          <select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value as Filtro)} className="input">
            <option value="todos">Todos</option>
            <option value="facturas">Facturas (33, 34, 110)</option>
            <option value="liquidaciones">Liquidaciones-Factura (43)</option>
            <option value="notas_debito">Notas Débito (56)</option>
            <option value="notas_credito">Notas Crédito (61)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">RUT receptor</label>
          <input
            type="text"
            value={rutFiltro}
            onChange={(e) => setRutFiltro(e.target.value)}
            placeholder="Sin DV (ej: 76123456)"
            className="input"
            inputMode="numeric"
          />
        </div>
      </div>

      <div className="text-sm text-[var(--muted)] mb-3">
        {loading ? "Cargando…" : `${totalCount.toLocaleString("es-CL")} ${totalCount === 1 ? "comprobante" : "comprobantes"}`}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error: {error}
        </div>
      )}

      {!rows && !error && loading && (
        <div className="flex items-center justify-center py-16 text-[var(--muted)]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando comprobantes…
        </div>
      )}

      {rows && rows.length === 0 && !loading && (
        <div className="rounded-lg border border-[var(--border)] p-8 text-center text-[var(--muted)]">
          Sin comprobantes en este rango.
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className="rounded-lg border border-[var(--border)] bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Fecha</th>
                  <th className="text-left font-medium px-3 py-2">Tipo</th>
                  <th className="text-right font-medium px-3 py-2">Folio</th>
                  <th className="text-left font-medium px-3 py-2">RUT receptor</th>
                  <th className="text-left font-medium px-3 py-2">Razón social</th>
                  <th className="text-right font-medium px-3 py-2">Neto</th>
                  <th className="text-right font-medium px-3 py-2">IVA</th>
                  <th className="text-right font-medium px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const esNC = (TIPO_NOTAS_CREDITO as readonly number[]).includes(r.cod_tipo_doc);
                  const esAnulado = !!r.anulado;
                  return (
                    <tr key={r.id} className={`border-t border-[var(--border)] hover:bg-slate-50 ${esAnulado ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2 whitespace-nowrap">{r.fecha_doc ? formatDate(r.fecha_doc, "es-CL") : "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-1.5 py-0.5 text-xs rounded ${esNC ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"}`}>
                          {tipoLabel(r.cod_tipo_doc)}
                        </span>
                        {esAnulado && <span className="ml-1 text-xs text-red-600">(anulado)</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.folio}</td>
                      <td className="px-3 py-2 tabular-nums">{formatRutReceptor(r.rut_receptor, r.dv_receptor)}</td>
                      <td className="px-3 py-2 max-w-xs truncate" title={r.razon_social_receptor ?? ""}>
                        {r.razon_social_receptor ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.monto_neto ? formatMoney(r.monto_neto, "CLP", "es-CL") : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.monto_iva ? formatMoney(r.monto_iva, "CLP", "es-CL") : "—"}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${esNC ? "text-red-600" : ""}`}>
                        {esNC ? "− " : ""}{formatMoney(r.monto_total, "CLP", "es-CL")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-between mt-3 text-sm">
              <span className="text-[var(--muted)]">
                Página {page + 1} de {totalPaginas.toLocaleString("es-CL")}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0 || loading}
                  className="px-3 py-1.5 rounded-md border border-[var(--border)] hover:bg-slate-50 disabled:opacity-40"
                >
                  ← Anterior
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPaginas - 1, p + 1))}
                  disabled={page >= totalPaginas - 1 || loading}
                  className="px-3 py-1.5 rounded-md border border-[var(--border)] hover:bg-slate-50 disabled:opacity-40"
                >
                  Siguiente →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
