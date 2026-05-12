"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { Loader2, Download, RefreshCw, AlertTriangle, Info, ExternalLink } from "lucide-react";
import { useConfig } from "@/lib/useConfig";
import * as XLSX from "xlsx";

type Order = {
  ml_order_id: number;
  ml_seller_id: number;
  date_closed: string | null;
  date_created: string;
  status: string | null;
  total_amount: number | null;
  paid_amount: number | null;
  shipping_cost: number | null;
  buyer_nickname: string | null;
  pack_id: number | null;
};

type Seller = { ml_user_id: number; nickname: string | null; site_id: string | null };
type StatusFilter = "todos" | "paid" | "partially_paid" | "partially_refunded" | "cancelled" | "pending";

type SyncStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "ok"; ordenes: number }
  | { state: "error"; msg: string };

const PAGE_SIZE = 50;
const EXPORT_CHUNK = 1000;
const EXPORT_HARD_LIMIT = 100000;

const COUNTRY_TO_ML = {
  CL: { siteId: "MLC", currency: "CLP" as const, locale: "es-CL", label: "Chile" },
  MX: { siteId: "MLM", currency: "MXN" as const, locale: "es-MX", label: "México" },
} as const;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_STYLES: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-700",
  partially_paid: "bg-amber-100 text-amber-700",
  partially_refunded: "bg-orange-100 text-orange-700",
  cancelled: "bg-red-100 text-red-700",
  pending: "bg-slate-100 text-slate-700",
};

export default function VentasMercadoLibrePage() {
  const { config } = useConfig();
  const pais = config?.pais as "CL" | "MX" | undefined;
  const cfg = pais && pais in COUNTRY_TO_ML ? COUNTRY_TO_ML[pais as "CL" | "MX"] : null;

  const params = useSearchParams();
  const initialDesde = params.get("desde") ?? "2026-01-01";
  const initialHasta = params.get("hasta") ?? todayISO();

  const [desde, setDesde] = useState(initialDesde);
  const [hasta, setHasta] = useState(initialHasta);
  const [statusFiltro, setStatusFiltro] = useState<StatusFilter>("todos");
  const [orderIdFiltro, setOrderIdFiltro] = useState("");
  const [orderIdAplicado, setOrderIdAplicado] = useState("");

  const [sellers, setSellers] = useState<Seller[]>([]);
  const [rows, setRows] = useState<Order[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  const [sync, setSync] = useState<SyncStatus>({ state: "idle" });
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  useEffect(() => { setPage(0); }, [desde, hasta, statusFiltro, orderIdAplicado]);
  useEffect(() => {
    const id = setTimeout(() => setOrderIdAplicado(orderIdFiltro.trim()), 400);
    return () => clearTimeout(id);
  }, [orderIdFiltro]);

  // Cargar sellers conectados del país activo (para mostrar quiénes hay y permitir reconectar)
  useEffect(() => {
    if (!cfg) return;
    const supabase = createClient();
    supabase
      .from("ml_oauth_cache")
      .select("ml_user_id, nickname, site_id")
      .eq("site_id", cfg.siteId)
      .then(({ data }) => setSellers((data ?? []) as Seller[]));
  }, [cfg]);

  const loadPage = useCallback(async () => {
    if (!cfg) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    let query = supabase
      .from("ml_ordenes")
      .select(
        "ml_order_id, ml_seller_id, date_closed, date_created, status, total_amount, paid_amount, shipping_cost, buyer_nickname, pack_id",
        { count: "exact" },
      )
      .eq("site_id", cfg.siteId)
      .gte("date_closed", desde + "T00:00:00Z")
      .lte("date_closed", hasta + "T23:59:59Z")
      .order("date_closed", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (statusFiltro !== "todos") query = query.eq("status", statusFiltro);
    if (orderIdAplicado) {
      const digits = orderIdAplicado.replace(/\D/g, "");
      if (digits) query = query.eq("ml_order_id", Number(digits));
    }

    const { data, error: err, count } = await query;
    if (err) { setError(err.message); setRows([]); setTotalCount(0); setLoading(false); return; }
    setRows((data ?? []) as Order[]);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [desde, hasta, statusFiltro, orderIdAplicado, page, cfg]);

  useEffect(() => { loadPage(); }, [loadPage]);

  async function handleSync() {
    setSync({ state: "running" });
    try {
      const r = await fetch("/api/ml/sync-orders", { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.ok) { setSync({ state: "error", msg: j.error ?? `HTTP ${r.status}` }); return; }
      setSync({ state: "ok", ordenes: j.ordenesNuevas ?? 0 });
      await loadPage();
    } catch (e) {
      setSync({ state: "error", msg: String(e) });
    }
  }

  async function exportExcel() {
    if (!cfg) return;
    setExporting(true);
    setExportProgress(0);
    try {
      const supabase = createClient();
      const all: Array<Record<string, unknown>> = [];
      let from = 0;
      while (from < EXPORT_HARD_LIMIT) {
        let query = supabase
          .from("ml_ordenes")
          .select("ml_order_id, ml_seller_id, date_closed, status, total_amount, paid_amount, shipping_cost, buyer_nickname, pack_id")
          .eq("site_id", cfg.siteId)
          .gte("date_closed", desde + "T00:00:00Z")
          .lte("date_closed", hasta + "T23:59:59Z")
          .order("date_closed", { ascending: false })
          .range(from, from + EXPORT_CHUNK - 1);
        if (statusFiltro !== "todos") query = query.eq("status", statusFiltro);
        if (orderIdAplicado) {
          const digits = orderIdAplicado.replace(/\D/g, "");
          if (digits) query = query.eq("ml_order_id", Number(digits));
        }
        const { data, error: err } = await query;
        if (err) { setError(err.message); return; }
        if (!data || data.length === 0) break;
        all.push(...(data as Array<Record<string, unknown>>));
        setExportProgress(all.length);
        if (data.length < EXPORT_CHUNK) break;
        from += EXPORT_CHUNK;
      }
      const exportData = all.map((r) => ({
        Fecha: r.date_closed,
        "ID Orden": r.ml_order_id,
        Seller: r.ml_seller_id,
        Estado: r.status ?? "",
        Comprador: r.buyer_nickname ?? "",
        "Paid amount": r.paid_amount ?? "",
        "Total amount": r.total_amount ?? "",
        Envío: r.shipping_cost ?? "",
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Mercado Libre");
      XLSX.writeFile(wb, `ml-${pais?.toLowerCase()}-ventas-${desde}-a-${hasta}.xlsx`);
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  }

  if (!cfg) {
    return (
      <div>
        <PageHeader title="Mercado Libre — Ventas" />
        <div className="rounded-lg border border-[var(--border)] p-8 text-center text-[var(--muted)]">
          Esta página solo está disponible cuando el país activo es Chile o México.
        </div>
      </div>
    );
  }

  const sinSellers = sellers.length === 0;
  const totalPaginas = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title={`Mercado Libre ${cfg.label} — Ventas`}
        description="Detalle orden por orden sincronizado desde tu cuenta de Mercado Libre."
        action={
          <div className="flex gap-2">
            <button onClick={handleSync} disabled={sync.state === "running"} className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white hover:bg-slate-50 disabled:opacity-50">
              {sync.state === "running" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {sync.state === "running" ? "Sincronizando…" : "Sincronizar"}
            </button>
            <button onClick={exportExcel} disabled={exporting || totalCount === 0} className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--border)] hover:bg-slate-50 disabled:opacity-50">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {exporting ? (exportProgress > 0 ? `${exportProgress.toLocaleString(cfg.locale)}/${totalCount.toLocaleString(cfg.locale)}…` : "Generando…") : "Exportar Excel"}
            </button>
          </div>
        }
      />

      {sinSellers && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900 flex items-start gap-3">
          <Info className="w-5 h-5 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium mb-1">No hay cuentas conectadas para {cfg.label}</div>
            <a href={`/api/ml/oauth/start?country=${pais}`} className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]">
              <ExternalLink className="w-4 h-4" /> Conectar Mercado Libre {cfg.label}
            </a>
          </div>
        </div>
      )}

      {!sinSellers && sellers.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--accent)]/40 p-3 mb-4 flex items-center gap-2 text-sm text-slate-700 flex-wrap">
          <Info className="w-4 h-4 shrink-0 text-[var(--primary)]" />
          Conectados:{" "}
          {sellers.map((s) => (
            <span key={s.ml_user_id} className="inline-block px-2 py-0.5 bg-white rounded border border-[var(--border)] mr-1">
              {s.nickname ?? `Seller ${s.ml_user_id}`}
            </span>
          ))}
        </div>
      )}

      {sync.state === "ok" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 mb-4 text-sm text-emerald-700">
          {sync.ordenes} órdenes nuevas sincronizadas.
        </div>
      )}

      {sync.state === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 mb-4 flex items-start gap-2 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 mt-0.5" /> {sync.msg}
        </div>
      )}

      {!sinSellers && (
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
              <option value="paid">Pagada</option>
              <option value="partially_paid">Pago parcial</option>
              <option value="partially_refunded">Reembolso parcial</option>
              <option value="cancelled">Cancelada</option>
              <option value="pending">Pendiente</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">ID de orden</label>
            <input type="text" value={orderIdFiltro} onChange={(e) => setOrderIdFiltro(e.target.value)} placeholder="Buscar order_id" className="input" inputMode="numeric" />
          </div>
        </div>
      )}

      {!sinSellers && (
        <div className="text-sm text-[var(--muted)] mb-3">
          {loading ? "Cargando…" : `${totalCount.toLocaleString(cfg.locale)} ${totalCount === 1 ? "orden" : "órdenes"}`}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">Error: {error}</div>
      )}

      {!sinSellers && rows && rows.length === 0 && !loading && (
        <div className="rounded-lg border border-[var(--border)] p-8 text-center text-[var(--muted)]">
          Sin órdenes en este rango.
        </div>
      )}

      {!sinSellers && rows && rows.length > 0 && (
        <>
          <div className="rounded-lg border border-[var(--border)] bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Fecha</th>
                  <th className="text-left font-medium px-3 py-2">ID Orden</th>
                  <th className="text-left font-medium px-3 py-2">Comprador</th>
                  <th className="text-right font-medium px-3 py-2">Envío</th>
                  <th className="text-right font-medium px-3 py-2">Total</th>
                  <th className="text-left font-medium px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const monto = o.paid_amount ?? o.total_amount ?? 0;
                  const cancelada = o.status === "cancelled";
                  return (
                    <tr key={o.ml_order_id} className={`border-t border-[var(--border)] hover:bg-slate-50 ${cancelada ? "opacity-60" : ""}`}>
                      <td className="px-3 py-2 whitespace-nowrap">{o.date_closed ? formatDate(o.date_closed, cfg.locale) : "—"}</td>
                      <td className="px-3 py-2 tabular-nums font-mono text-xs">{o.ml_order_id}</td>
                      <td className="px-3 py-2 truncate max-w-xs" title={o.buyer_nickname ?? ""}>{o.buyer_nickname ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[var(--muted)]">
                        {o.shipping_cost ? formatMoney(o.shipping_cost, cfg.currency, cfg.locale) : "—"}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${cancelada ? "text-red-600 line-through" : ""}`}>
                        {formatMoney(monto, cfg.currency, cfg.locale)}
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
              <span className="text-[var(--muted)]">Página {page + 1} de {totalPaginas.toLocaleString(cfg.locale)}</span>
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
