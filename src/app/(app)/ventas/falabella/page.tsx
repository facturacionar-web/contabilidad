"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { Loader2, Download, RefreshCw, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import * as XLSX from "xlsx";

type Order = {
  order_id: number;
  order_number: number | null;
  created_at_fb: string;
  customer_rut: string | null;
  items_count: number | null;
  grand_total: number;
  voucher_amount: number | null;
  status: string | null;
  shipping_type: string | null;
};

type StatusFilter = "todos" | "delivered" | "ready_to_ship" | "shipped" | "canceled" | "returned" | "failed" | "pending";

type SyncStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "ok"; ordenes: number; items: number }
  | { state: "error"; msg: string };

const PAGE_SIZE = 50;
const EXPORT_CHUNK = 1000;
const EXPORT_HARD_LIMIT = 100000;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_STYLES: Record<string, string> = {
  delivered: "bg-emerald-100 text-emerald-700",
  ready_to_ship: "bg-blue-100 text-blue-700",
  shipped: "bg-indigo-100 text-indigo-700",
  canceled: "bg-red-100 text-red-700",
  returned: "bg-orange-100 text-orange-700",
  failed: "bg-red-100 text-red-700",
  pending: "bg-amber-100 text-amber-700",
};

export default function FalabellaVentasPage() {
  const params = useSearchParams();
  const initialDesde = params.get("desde") ?? "2026-01-01";
  const initialHasta = params.get("hasta") ?? todayISO();

  const [desde, setDesde] = useState(initialDesde);
  const [hasta, setHasta] = useState(initialHasta);
  const [statusFiltro, setStatusFiltro] = useState<StatusFilter>("todos");
  const [orderNumFiltro, setOrderNumFiltro] = useState("");
  const [orderNumAplicado, setOrderNumAplicado] = useState("");

  const [rows, setRows] = useState<Order[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  const [sync, setSync] = useState<SyncStatus>({ state: "idle" });
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [desde, hasta, statusFiltro, orderNumAplicado]);

  useEffect(() => {
    const id = setTimeout(() => setOrderNumAplicado(orderNumFiltro.trim()), 400);
    return () => clearTimeout(id);
  }, [orderNumFiltro]);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    let query = supabase
      .from("falabella_orders")
      .select(
        "order_id, order_number, created_at_fb, customer_rut, items_count, grand_total, voucher_amount, status, shipping_type",
        { count: "exact" },
      )
      .gte("created_at_fb", desde + "T00:00:00+00:00")
      .lte("created_at_fb", hasta + "T23:59:59+00:00")
      .order("created_at_fb", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (statusFiltro !== "todos") {
      query = query.eq("status", statusFiltro);
    }
    if (orderNumAplicado) {
      const digits = orderNumAplicado.replace(/\D/g, "");
      if (digits) query = query.eq("order_number", Number(digits));
    }

    const { data, error: err, count } = await query;
    if (err) {
      setError(err.message);
      setRows([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as Order[]);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [desde, hasta, statusFiltro, orderNumAplicado, page]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  async function handleSync() {
    setSync({ state: "running" });
    try {
      const r = await fetch("/api/falabella/sync-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dias: 7 }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setSync({ state: "error", msg: j.error ?? `HTTP ${r.status}` });
        return;
      }
      setSync({ state: "ok", ordenes: j.ordenesUpsert ?? 0, items: j.itemsUpsert ?? 0 });
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
          .from("falabella_orders")
          .select("order_id, order_number, created_at_fb, customer_rut, items_count, grand_total, voucher_amount, status, shipping_type")
          .gte("created_at_fb", desde + "T00:00:00+00:00")
          .lte("created_at_fb", hasta + "T23:59:59+00:00")
          .order("created_at_fb", { ascending: false })
          .range(from, from + EXPORT_CHUNK - 1);

        if (statusFiltro !== "todos") query = query.eq("status", statusFiltro);
        if (orderNumAplicado) {
          const digits = orderNumAplicado.replace(/\D/g, "");
          if (digits) query = query.eq("order_number", Number(digits));
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
        Fecha: r.created_at_fb,
        "N° Orden": r.order_number ?? "",
        "Order ID": r.order_id,
        "RUT cliente": r.customer_rut ?? "",
        Items: r.items_count ?? 0,
        Total: r.grand_total ?? 0,
        Voucher: r.voucher_amount ?? 0,
        Estado: r.status ?? "",
        Envío: r.shipping_type ?? "",
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Falabella");
      XLSX.writeFile(wb, `falabella-ventas-${desde}-a-${hasta}.xlsx`);
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  }

  const totalPaginas = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Falabella — Ventas"
        description="Órdenes sincronizadas desde el Seller Center de Falabella Chile."
        action={
          <div className="flex gap-2">
            <button
              onClick={handleSync}
              disabled={sync.state === "running"}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white hover:bg-slate-50 disabled:opacity-50"
            >
              {sync.state === "running" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {sync.state === "running" ? "Sincronizando…" : "Sincronizar"}
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
          {sync.ordenes.toLocaleString("es-CL")} órdenes y {sync.items.toLocaleString("es-CL")} items sincronizados.
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
          Sync automático diario. El botón &quot;Sincronizar&quot; trae las órdenes de los últimos 7 días para capturar
          cambios de estado en órdenes recientes.
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
            <option value="delivered">Entregada</option>
            <option value="ready_to_ship">Lista para enviar</option>
            <option value="shipped">Enviada</option>
            <option value="pending">Pendiente</option>
            <option value="canceled">Cancelada</option>
            <option value="returned">Devolución</option>
            <option value="failed">Fallida</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">N° de orden</label>
          <input
            type="text"
            value={orderNumFiltro}
            onChange={(e) => setOrderNumFiltro(e.target.value)}
            placeholder="Buscar OrderNumber exacto"
            className="input"
            inputMode="numeric"
          />
        </div>
      </div>

      <div className="text-sm text-[var(--muted)] mb-3">
        {loading ? "Cargando…" : `${totalCount.toLocaleString("es-CL")} ${totalCount === 1 ? "orden" : "órdenes"}`}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">Error: {error}</div>
      )}

      {!rows && !error && loading && (
        <div className="flex items-center justify-center py-16 text-[var(--muted)]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando órdenes…
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
                  <th className="text-left font-medium px-3 py-2">N° Orden</th>
                  <th className="text-left font-medium px-3 py-2">RUT cliente</th>
                  <th className="text-right font-medium px-3 py-2">Items</th>
                  <th className="text-right font-medium px-3 py-2">Voucher</th>
                  <th className="text-right font-medium px-3 py-2">Total</th>
                  <th className="text-left font-medium px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const cancelada = o.status === "canceled" || o.status === "failed";
                  return (
                    <tr key={o.order_id} className={`border-t border-[var(--border)] hover:bg-slate-50 ${cancelada ? "opacity-60" : ""}`}>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDate(o.created_at_fb, "es-CL")}</td>
                      <td className="px-3 py-2 tabular-nums">{o.order_number ?? o.order_id}</td>
                      <td className="px-3 py-2">{o.customer_rut ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{o.items_count ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[var(--muted)]">
                        {o.voucher_amount ? formatMoney(o.voucher_amount, "CLP", "es-CL") : "—"}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${cancelada ? "text-red-600 line-through" : ""}`}>
                        {formatMoney(o.grand_total, "CLP", "es-CL")}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-1.5 py-0.5 text-xs rounded ${STATUS_STYLES[o.status ?? ""] ?? "bg-slate-100 text-slate-700"}`}>
                          {o.status ?? "—"}
                        </span>
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
