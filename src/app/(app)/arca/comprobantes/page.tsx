"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { Loader2, Download, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  TIPO_FACTURAS,
  TIPO_NOTAS_DEBITO,
  TIPO_NOTAS_CREDITO,
  TIPOS_RELEVANTES,
  tipoLabel,
} from "@/lib/arca/tipos-cbte";
import * as XLSX from "xlsx";

type Cbte = {
  id: number;
  fecha_cbte: string;
  pto_vta: number;
  cbte_tipo: number;
  cbte_nro: number;
  doc_tipo: number | null;
  doc_nro: number | null;
  imp_total: number;
  imp_neto: number | null;
  imp_iva: number | null;
  cae: string;
  resultado: string | null;
};

type Filtro = "todos" | "facturas" | "notas_credito" | "notas_debito";

type SyncStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "ok"; nuevos: number }
  | { state: "error"; msg: string };

const PAGE_SIZE = 50;
const EXPORT_CHUNK = 1000;       // Supabase devuelve max 1000 por query
const EXPORT_HARD_LIMIT = 100000; // tope absoluto para no quedar colgado

function firstDayOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function tiposPorFiltro(f: Filtro): readonly number[] {
  if (f === "facturas") return TIPO_FACTURAS;
  if (f === "notas_debito") return TIPO_NOTAS_DEBITO;
  if (f === "notas_credito") return TIPO_NOTAS_CREDITO;
  return TIPOS_RELEVANTES;
}

export default function ArcaComprobantesPage() {
  const params = useSearchParams();
  const initialDesde = params.get("desde") ?? firstDayOfMonth();
  const initialHasta = params.get("hasta") ?? todayISO();

  const [desde, setDesde] = useState(initialDesde);
  const [hasta, setHasta] = useState(initialHasta);
  const [tipoFiltro, setTipoFiltro] = useState<Filtro>("todos");
  const [ptoVtaFiltro, setPtoVtaFiltro] = useState<string>("todos");
  const [docNroFiltro, setDocNroFiltro] = useState("");
  const [docNroAplicado, setDocNroAplicado] = useState("");

  const [rows, setRows] = useState<Cbte[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  const [ptosVentaDisponibles, setPtosVentaDisponibles] = useState<number[]>([]);
  const [sync, setSync] = useState<SyncStatus>({ state: "idle" });
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // Cargar PtoVta una sola vez (vista distinct)
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("arca_ptos_venta_v")
      .select("pto_vta")
      .then(({ data }) => {
        if (data) setPtosVentaDisponibles(data.map((r) => Number(r.pto_vta)));
      });
  }, []);

  // Reset página cuando cambian filtros
  useEffect(() => {
    setPage(0);
  }, [desde, hasta, tipoFiltro, ptoVtaFiltro, docNroAplicado]);

  // Debounce del filtro CUIT/DNI (aplica recién después de 400ms sin tipear)
  useEffect(() => {
    const id = setTimeout(() => setDocNroAplicado(docNroFiltro.trim()), 400);
    return () => clearTimeout(id);
  }, [docNroFiltro]);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const tipos = tiposPorFiltro(tipoFiltro);
    let query = supabase
      .from("arca_comprobantes_emitidos")
      .select(
        "id, fecha_cbte, pto_vta, cbte_tipo, cbte_nro, doc_tipo, doc_nro, imp_total, imp_neto, imp_iva, cae, resultado",
        { count: "exact" },
      )
      .in("cbte_tipo", tipos as unknown as number[])
      .gte("fecha_cbte", desde)
      .lte("fecha_cbte", hasta)
      .order("fecha_cbte", { ascending: false })
      .order("cbte_nro", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (ptoVtaFiltro !== "todos") {
      query = query.eq("pto_vta", Number(ptoVtaFiltro));
    }
    if (docNroAplicado) {
      // doc_nro es bigint en BD. Acepta solo dígitos.
      const onlyDigits = docNroAplicado.replace(/\D/g, "");
      if (onlyDigits) {
        query = query.eq("doc_nro", Number(onlyDigits));
      }
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
  }, [desde, hasta, tipoFiltro, ptoVtaFiltro, docNroAplicado, page]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

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
      setSync({ state: "ok", nuevos: j.comprobantesNuevos ?? 0 });
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

      // Fetch paginado: Supabase devuelve max 1000 por query. Iteramos.
      const all: Array<Record<string, unknown>> = [];
      let from = 0;
      while (from < EXPORT_HARD_LIMIT) {
        let query = supabase
          .from("arca_comprobantes_emitidos")
          .select("fecha_cbte, pto_vta, cbte_tipo, cbte_nro, doc_tipo, doc_nro, imp_total, imp_neto, imp_iva, cae, resultado")
          .in("cbte_tipo", tipos as unknown as number[])
          .gte("fecha_cbte", desde)
          .lte("fecha_cbte", hasta)
          .order("fecha_cbte", { ascending: false })
          .order("cbte_nro", { ascending: false })
          .range(from, from + EXPORT_CHUNK - 1);

        if (ptoVtaFiltro !== "todos") query = query.eq("pto_vta", Number(ptoVtaFiltro));
        if (docNroAplicado) {
          const onlyDigits = docNroAplicado.replace(/\D/g, "");
          if (onlyDigits) query = query.eq("doc_nro", Number(onlyDigits));
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
        Fecha: r.fecha_cbte,
        "Pto Vta": r.pto_vta,
        Tipo: tipoLabel(r.cbte_tipo as number),
        Número: r.cbte_nro,
        "Doc receptor": r.doc_nro ?? "",
        Neto: r.imp_neto ?? "",
        IVA: r.imp_iva ?? "",
        Total: r.imp_total,
        CAE: r.cae,
        Resultado: r.resultado ?? "",
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "ARCA");
      XLSX.writeFile(wb, `arca-comprobantes-${desde}-a-${hasta}.xlsx`);
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  }

  const totalPaginas = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="ARCA — Comprobantes emitidos"
        description="Detalle de cada comprobante sincronizado desde ARCA. Filtrá por fecha, punto de venta, tipo o CUIT del receptor."
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
                  ? `${exportProgress.toLocaleString("es-AR")}/${totalCount.toLocaleString("es-AR")}…`
                  : "Generando…"
                : "Exportar Excel"}
            </button>
          </div>
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

      {/* Filtros */}
      <div className="rounded-lg border border-[var(--border)] bg-white p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
            <option value="facturas">Facturas</option>
            <option value="notas_debito">Notas de Débito</option>
            <option value="notas_credito">Notas de Crédito</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">Pto. Vta</label>
          <select value={ptoVtaFiltro} onChange={(e) => setPtoVtaFiltro(e.target.value)} className="input">
            <option value="todos">Todos</option>
            {ptosVentaDisponibles.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">CUIT/DNI receptor</label>
          <input
            type="text"
            value={docNroFiltro}
            onChange={(e) => setDocNroFiltro(e.target.value)}
            placeholder="Buscar por número exacto"
            className="input"
            inputMode="numeric"
          />
        </div>
      </div>

      {/* Stats */}
      <div className="text-sm text-[var(--muted)] mb-3 flex items-center gap-2">
        <span>
          {loading
            ? "Cargando…"
            : `${totalCount.toLocaleString("es-AR")} ${totalCount === 1 ? "comprobante" : "comprobantes"}`}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error cargando datos: {error}
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
                  <th className="text-right font-medium px-3 py-2">PV-Nº</th>
                  <th className="text-left font-medium px-3 py-2">Doc receptor</th>
                  <th className="text-right font-medium px-3 py-2">Neto</th>
                  <th className="text-right font-medium px-3 py-2">IVA</th>
                  <th className="text-right font-medium px-3 py-2">Total</th>
                  <th className="text-left font-medium px-3 py-2">CAE</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const esNC = (TIPO_NOTAS_CREDITO as readonly number[]).includes(r.cbte_tipo);
                  return (
                    <tr key={r.id} className="border-t border-[var(--border)] hover:bg-slate-50">
                      <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.fecha_cbte)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-1.5 py-0.5 text-xs rounded ${esNC ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"}`}>
                          {tipoLabel(r.cbte_tipo)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {String(r.pto_vta).padStart(4, "0")}-{String(r.cbte_nro).padStart(8, "0")}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{r.doc_nro ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.imp_neto ? formatMoney(r.imp_neto, "ARS") : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.imp_iva ? formatMoney(r.imp_iva, "ARS") : "—"}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${esNC ? "text-red-600" : ""}`}>
                        {esNC ? "− " : ""}{formatMoney(r.imp_total, "ARS")}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--muted)] tabular-nums">{r.cae}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-between mt-3 text-sm">
              <span className="text-[var(--muted)]">
                Página {page + 1} de {totalPaginas.toLocaleString("es-AR")}
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
