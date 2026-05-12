"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { Loader2, Download, RefreshCw, CheckCircle2, AlertTriangle, Info, ExternalLink } from "lucide-react";
import * as XLSX from "xlsx";

type Order = {
  purchase_order_id: string;
  customer_order_id: string | null;
  order_date: string;
  estimated_ship_date: string | null;
  status: string | null;
  total_amount: number | null;
  total_quantity: number | null;
};

type StatusFilter = "todos" | "Created" | "Acknowledged" | "Shipped" | "Delivered" | "Cancelled";

type SyncStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "ok"; ordenes: number; lines: number }
  | { state: "error"; msg: string };

const PAGE_SIZE = 50;
const EXPORT_CHUNK = 1000;
const EXPORT_HARD_LIMIT = 100000;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_STYLES: Record<string, string> = {
  Created: "bg-amber-100 text-amber-700",
  Acknowledged: "bg-blue-100 text-blue-700",
  Shipped: "bg-indigo-100 text-indigo-700",
  Delivered: "bg-emerald-100 text-emerald-700",
  Cancelled: "bg-red-100 text-red-700",
};

export default function VentasWalmartPage() {
  const params = useSearchParams();
  const initialDesde = params.get("desde") ?? "2026-01-01";
  const initialHasta = params.get("hasta") ?? todayISO();

  const [desde, setDesde] = useState(initialDesde);
  const [hasta, setHasta] = useState(initialHasta);
  const [statusFiltro, setStatusFiltro] = useState<StatusFilter>("todos");
  const [poFiltro, setPoFiltro] = useState("");
  const [poAplicado, setPoAplicado] = useState("");

  const [rows, setRows] = useState<Order[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  const [sync, setSync] = useState<SyncStatus>({ state: "idle" });
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  useEffect(() => { setPage(0); }, [desde, hasta, statusFiltro, poAplicado]);
  useEffect(() => {
    const id = setTimeout(() => setPoAplicado(poFiltro.trim()), 400);
    return () => clearTimeout(id);
  }, [poFiltro]);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    let query = supabase
      .from("walmart_orders")
      .select("purchase_order_id, customer_order_id, order_date, estimated_ship_date, status, total_amount, total_quantity", { count: "exact" })
      .gte("order_date", desde + "T00:00:00Z")
      .lte("order_date", hasta + "T23:59:59Z")
      .order("order_date", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (statusFiltro !== "todos") query = query.eq("status", statusFiltro);
    if (poAplicado) query = query.ilike("purchase_order_id", `%${poAplicado}%`);

    const { data, error: err, count } = await query;
    if (err) { setError(err.message); setRows([]); setTotalCount(0); setLoading(false); return; }
    setRows((data ?? []) as Order[]);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [desde, hasta, statusFiltro, poAplicado, page]);

  useEffect(() => { loadPage(); }, [loadPage]);

  async function handleSync() {
    setSync({ state: "running" });
    try {
      const r = await fetch("/api/walmart/sync-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dias: 7 }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { setSync({ state: "error", msg: j.error ?? `HTTP ${r.status}` }); return; }
      setSync({ state: "ok", ordenes: j.ordenesUpsert ?? 0, lines: j.linesUpsert ?? 0 });
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
      const all: Array<Record<string, unknown>> = [];
      let from = 0;
      while (from < EXPORT_HARD_LIMIT) {
        let query = supabase
          .from("walmart_orders")
          .select("purchase_order_id, customer_order_id, order_date, status, total_amount, total_quantity")
          .gte("order_date", desde + "T00:00:00Z")
          .lte("order_date", hasta + "T23:59:59Z")
          .order("order_date", { ascending: false })
          .range(from, from + EXPORT_CHUNK - 1);
        if (statusFiltro !== "todos") query = query.eq("status", statusFiltro);
        if (poAplicado) query = query.ilike("purchase_order_id", `%${poAplicado}%`);

        const { data, error: err } = await query;
        if (err) { setError(err.message); return; }
        if (!data || data.length === 0) break;
        all.push(...(data as Array<Record<string, unknown>>));
        setExportProgress(all.length);
        if (data.length < EXPORT_CHUNK) break;
        from += EXPORT_CHUNK;
      }
      const exportData = all.map((r) => ({
        Fecha: r.order_date,
        "Purchase Order": r.purchase_order_id,
        "Customer Order": r.customer_order_id ?? "",
        Estado: r.status ?? "",
        Items: r.total_quantity ?? 0,
        Total: r.total_amount ?? 0,
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Walmart");
      XLSX.writeFile(wb, `walmart-ventas-${desde}-a-${hasta}.xlsx`);
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  }

  const totalPaginas = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Walmart — Ventas"
        description="Órdenes sincronizadas desde el Marketplace de Walmart Chile."
        action={
          <div className="flex gap-2">
            <button onClick={handleSync} disabled={sync.state === "running"} className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white hover:bg-slate-50 disabled:opacity-50">
              {sync.state === "running" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {sync.state === "running" ? "Sincronizando…" : "Sincronizar"}
            </button>
            <button onClick={exportExcel} disabled={exporting || totalCount === 0} className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--border)] hover:bg-slate-50 disabled:opacity-50">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {exporting ? (exportProgress > 0 ? `${exportProgress.toLocaleString("es-CL")}/${totalCount.toLocaleString("es-CL")}…` : "Generando…") : "Exportar Excel"}
            </button>
          </div>
        }
      />

      {sync.state === "ok" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 mb-4 flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {sync.ordenes.toLocaleString("es-CL")} órdenes y {sync.lines.toLocaleString("es-CL")} líneas sincronizadas.
        </div>
      )}

      {sync.state === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 mb-4 flex items-start gap-2 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{sync.msg}</div>
        </div>
      )}

      <div className="rounded-lg border border-[var(--border)] bg-[var(--accent)]/40 p-3 mb-4 flex items-start gap-2 text-sm text-slate-600">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-[var(--primary)]" />
        <div>
          Walmart Chile expone estados <strong>Created</strong> y <strong>Acknowledged</strong>. El sync diario trae los últimos 7 días para captar cambios. Tracking via Enviame al hacer click en el folio.
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
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">Estado</label>
          <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value as StatusFilter)} className="input">
            <option value="todos">Todos</option>
            <option value="Created">Created</option>
            <option value="Acknowledged">Acknowledged</option>
            <option value="Shipped">Shipped</option>
            <option value="Delivered">Delivered</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">Purchase Order</label>
          <input type="text" value={poFiltro} onChange={(e) => setPoFiltro(e.target.value)} placeholder="Buscar P..." className="input" />
        </div>
      </div>

      <div className="text-sm text-[var(--muted)] mb-3">
        {loading ? "Cargando…" : `${totalCount.toLocaleString("es-CL")} ${totalCount === 1 ? "orden" : "órdenes"}`}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">Error: {error}</div>}

      {!rows && !error && loading && (
        <div className="flex items-center justify-center py-16 text-[var(--muted)]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando…
        </div>
      )}

      {rows && rows.length === 0 && !loading && (
        <div className="rounded-lg border border-[var(--border)] p-8 text-center text-[var(--muted)]">
          Sin órdenes en este rango.
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className="rounded-lg border border-[var(--border)] bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Fecha</th>
                  <th className="text-left font-medium px-3 py-2">PO</th>
                  <th className="text-left font-medium px-3 py-2">Customer Order</th>
                  <th className="text-right font-medium px-3 py-2">Items</th>
                  <th className="text-right font-medium px-3 py-2">Total</th>
                  <th className="text-left font-medium px-3 py-2">Estado</th>
                  <th className="text-right font-medium px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const cancelada = o.status === "Cancelled";
                  return (
                    <tr key={o.purchase_order_id} className={`border-t border-[var(--border)] hover:bg-slate-50 ${cancelada ? "opacity-60" : ""}`}>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDate(o.order_date, "es-CL")}</td>
                      <td className="px-3 py-2 tabular-nums font-mono text-xs">{o.purchase_order_id}</td>
                      <td className="px-3 py-2 tabular-nums text-xs">{o.customer_order_id ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{o.total_quantity ?? "—"}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${cancelada ? "text-red-600 line-through" : ""}`}>
                        {o.total_amount != null ? formatMoney(o.total_amount, "CLP", "es-CL") : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-1.5 py-0.5 text-xs rounded ${STATUS_STYLES[o.status ?? ""] ?? "bg-slate-100 text-slate-700"}`}>
                          {o.status ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <a href={`/ventas/walmart/${encodeURIComponent(o.purchase_order_id)}`} className="text-xs text-[var(--primary)] hover:underline inline-flex items-center gap-1">
                          Ver <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-between mt-3 text-sm">
              <span className="text-[var(--muted)]">Página {page + 1} de {totalPaginas.toLocaleString("es-CL")}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || loading} className="px-3 py-1.5 rounded-md border border-[var(--border)] hover:bg-slate-50 disabled:opacity-40">← Anterior</button>
                <button onClick={() => setPage((p) => Math.min(totalPaginas - 1, p + 1))} disabled={page >= totalPaginas - 1 || loading} className="px-3 py-1.5 rounded-md border border-[var(--border)] hover:bg-slate-50 disabled:opacity-40">Siguiente →</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
