"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { Loader2, Download, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";

type Orden = {
  id: number;
  ml_order_id: number;
  ml_seller_id: number;
  date_created: string;
  date_closed: string | null;
  status: string | null;
  total_amount: number;
  paid_amount: number | null;
  shipping_cost: number | null;
  currency_id: string | null;
  buyer_nickname: string | null;
  buyer_id: number | null;
};

type Seller = { seller_id: number; seller_label: string };

type SyncStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "ok"; ordenesNuevas: number }
  | { state: "error"; msg: string };

type StatusFiltro = "todos" | "paid" | "partially_paid" | "cancelled" | "invalid";

const PAGE_SIZE = 50;
const EXPORT_CHUNK = 1000;
const EXPORT_HARD_LIMIT = 100000;

function firstDayOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function statusLabel(s: string | null): string {
  if (s === "paid") return "Pagada";
  if (s === "partially_paid") return "Parcial";
  if (s === "cancelled") return "Cancelada";
  if (s === "invalid") return "Inválida";
  return s ?? "—";
}

function statusBadgeClass(s: string | null): string {
  if (s === "paid") return "bg-emerald-100 text-emerald-700";
  if (s === "partially_paid") return "bg-amber-100 text-amber-700";
  if (s === "cancelled" || s === "invalid") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-700";
}

export default function VentasMlPage() {
  const params = useSearchParams();
  const initialDesde = params.get("desde") ?? firstDayOfMonth();
  const initialHasta = params.get("hasta") ?? todayISO();

  const [desde, setDesde] = useState(initialDesde);
  const [hasta, setHasta] = useState(initialHasta);
  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>("paid");
  const [sellerFiltro, setSellerFiltro] = useState<string>("todos");
  const [buscar, setBuscar] = useState("");
  const [buscarAplicado, setBuscarAplicado] = useState("");

  const [rows, setRows] = useState<Orden[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  const [sellers, setSellers] = useState<Seller[]>([]);
  const [sync, setSync] = useState<SyncStatus>({ state: "idle" });
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // Cargar sellers para el dropdown
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("ml_sellers_v")
      .select("seller_id, seller_label")
      .then(({ data }) => {
        if (data) setSellers(data as Seller[]);
      });
  }, []);

  // Reset de página cuando cambian filtros
  useEffect(() => {
    setPage(0);
  }, [desde, hasta, statusFiltro, sellerFiltro, buscarAplicado]);

  // Debounce del filtro de búsqueda
  useEffect(() => {
    const id = setTimeout(() => setBuscarAplicado(buscar.trim()), 400);
    return () => clearTimeout(id);
  }, [buscar]);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    // Filtramos por date_closed cuando está disponible (alinea con ARCA).
    // Para órdenes sin date_closed (cancelled/invalid), filtramos por date_created.
    // En esta página el filtro es solo por date_closed, asumimos que el usuario
    // quiere ver órdenes que cerraron en el rango.
    let query = supabase
      .from("ml_ordenes")
      .select(
        "id, ml_order_id, ml_seller_id, date_created, date_closed, status, total_amount, paid_amount, shipping_cost, currency_id, buyer_nickname, buyer_id",
        { count: "exact" },
      )
      .not("date_closed", "is", null)
      .gte("date_closed", `${desde}T00:00:00-03:00`)
      .lte("date_closed", `${hasta}T23:59:59-03:00`)
      .order("date_closed", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (statusFiltro !== "todos") {
      query = query.eq("status", statusFiltro);
    }
    if (sellerFiltro !== "todos") {
      query = query.eq("ml_seller_id", Number(sellerFiltro));
    }
    if (buscarAplicado) {
      // Busca por orden_id exacto si es número, sino por nickname
      const onlyDigits = buscarAplicado.replace(/\D/g, "");
      if (onlyDigits && onlyDigits.length === buscarAplicado.length) {
        query = query.eq("ml_order_id", Number(onlyDigits));
      } else {
        query = query.ilike("buyer_nickname", `%${buscarAplicado}%`);
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
    setRows((data ?? []) as Orden[]);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [desde, hasta, statusFiltro, sellerFiltro, buscarAplicado, page]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

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
          .from("ml_ordenes")
          .select("ml_order_id, ml_seller_id, date_created, date_closed, status, total_amount, paid_amount, shipping_cost, currency_id, buyer_nickname, buyer_id")
          .not("date_closed", "is", null)
          .gte("date_closed", `${desde}T00:00:00-03:00`)
          .lte("date_closed", `${hasta}T23:59:59-03:00`)
          .order("date_closed", { ascending: false })
          .range(from, from + EXPORT_CHUNK - 1);

        if (statusFiltro !== "todos") query = query.eq("status", statusFiltro);
        if (sellerFiltro !== "todos") query = query.eq("ml_seller_id", Number(sellerFiltro));
        if (buscarAplicado) {
          const onlyDigits = buscarAplicado.replace(/\D/g, "");
          if (onlyDigits && onlyDigits.length === buscarAplicado.length) {
            query = query.eq("ml_order_id", Number(onlyDigits));
          } else {
            query = query.ilike("buyer_nickname", `%${buscarAplicado}%`);
          }
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

      const sellerById = new Map(sellers.map((s) => [String(s.seller_id), s.seller_label]));
      const exportData = all.map((r) => ({
        "Fecha cierre": r.date_closed ?? "",
        "Fecha creación": r.date_created,
        "Cuenta ML": sellerById.get(String(r.ml_seller_id)) ?? r.ml_seller_id,
        "Orden #": r.ml_order_id,
        Estado: statusLabel(r.status as string | null),
        Comprador: r.buyer_nickname ?? "",
        "Total (paid)": r.paid_amount ?? r.total_amount,
        "Total items": r.total_amount,
        Envío: r.shipping_cost ?? "",
        Moneda: r.currency_id ?? "ARS",
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "ML");
      XLSX.writeFile(wb, `ml-ventas-${desde}-a-${hasta}.xlsx`);
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  }

  const totalPaginas = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const sellerById = new Map(sellers.map((s) => [String(s.seller_id), s.seller_label]));

  return (
    <div>
      <PageHeader
        title="Mercado Libre — Ventas"
        description="Detalle de órdenes sincronizadas desde ML. Se actualiza automático cada 5h o forzá la sincronización con el botón."
        action={
          <div className="flex gap-2">
            <button
              onClick={handleSync}
              disabled={sync.state === "running"}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white hover:bg-slate-50 disabled:opacity-50"
            >
              {sync.state === "running" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
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

      {/* Filtros */}
      <div className="rounded-lg border border-[var(--border)] bg-white p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">Desde (cierre)</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="input" />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">Hasta (cierre)</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="input" />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">Cuenta</label>
          <select value={sellerFiltro} onChange={(e) => setSellerFiltro(e.target.value)} className="input">
            <option value="todos">Todas</option>
            {sellers.map((s) => (
              <option key={s.seller_id} value={s.seller_id}>{s.seller_label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">Estado</label>
          <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value as StatusFiltro)} className="input">
            <option value="paid">Pagadas</option>
            <option value="partially_paid">Parciales</option>
            <option value="cancelled">Canceladas</option>
            <option value="invalid">Inválidas</option>
            <option value="todos">Todos</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">Orden # o comprador</label>
          <input
            type="text"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar..."
            className="input"
          />
        </div>
      </div>

      <div className="text-sm text-[var(--muted)] mb-3">
        {loading
          ? "Cargando…"
          : `${totalCount.toLocaleString("es-AR")} ${totalCount === 1 ? "orden" : "órdenes"}`}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error cargando datos: {error}
        </div>
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
          <div className="rounded-lg border border-[var(--border)] bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Cierre</th>
                  <th className="text-left font-medium px-3 py-2">Cuenta</th>
                  <th className="text-right font-medium px-3 py-2">Orden #</th>
                  <th className="text-left font-medium px-3 py-2">Estado</th>
                  <th className="text-left font-medium px-3 py-2">Comprador</th>
                  <th className="text-right font-medium px-3 py-2">Items</th>
                  <th className="text-right font-medium px-3 py-2">Envío</th>
                  <th className="text-right font-medium px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--border)] hover:bg-slate-50">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.date_closed ? formatDate(r.date_closed) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--muted)]">
                      {sellerById.get(String(r.ml_seller_id)) ?? r.ml_seller_id}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">{r.ml_order_id}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-1.5 py-0.5 text-xs rounded ${statusBadgeClass(r.status)}`}>
                        {statusLabel(r.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2">{r.buyer_nickname ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(Number(r.total_amount), "ARS")}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--muted)]">
                      {r.shipping_cost ? formatMoney(Number(r.shipping_cost), "ARS") : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {formatMoney(Number(r.paid_amount ?? r.total_amount), "ARS")}
                    </td>
                  </tr>
                ))}
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
