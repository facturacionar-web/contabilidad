"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import PageHeader from "@/components/PageHeader";
import {
  Plus,
  Pencil,
  Trash2,
  RotateCcw,
  X,
  History,
  Filter,
  Loader2,
  ChevronDown,
  ChevronRight,
  User as UserIcon,
} from "lucide-react";
import { formatDate } from "@/lib/format";
import { useConfig } from "@/lib/useConfig";

type LogEntry = {
  id: number;
  user_id: string | null;
  user_email: string | null;
  ctx_pais: string | null;
  action: "create" | "update" | "delete" | "restore" | "purge";
  entity: string;
  entity_id: string;
  entity_label: string | null;
  changes: Record<string, unknown> | null;
  created_at: string;
};

const ENTITY_LABELS: Record<string, string> = {
  gastos: "Gasto / Factura",
  contactos: "Contacto",
  ingresos: "Ingreso",
  notas_credito: "Nota de crédito",
  conceptos: "Concepto",
  cuentas: "Cuenta",
};

const ACTION_META: Record<LogEntry["action"], { label: string; icon: React.ComponentType<{ className?: string }>; color: string; bg: string }> = {
  create:  { label: "Creó",       icon: Plus,    color: "text-emerald-600", bg: "bg-emerald-50" },
  update:  { label: "Modificó",   icon: Pencil,  color: "text-blue-600",    bg: "bg-blue-50" },
  delete:  { label: "Eliminó",    icon: Trash2,  color: "text-amber-600",   bg: "bg-amber-50" },
  restore: { label: "Restauró",   icon: RotateCcw, color: "text-teal-600",  bg: "bg-teal-50" },
  purge:   { label: "Eliminó definitivamente", icon: X, color: "text-red-600", bg: "bg-red-50" },
};

function entityHref(entity: string, id: string): string | null {
  switch (entity) {
    case "gastos": return `/egresos/facturas?editar=${id}`;
    case "contactos": return `/contactos/${id}`;
    case "ingresos": return `/ingresos/pagos-recibidos?editar=${id}`;
    case "notas_credito": return `/ingresos/notas-credito?editar=${id}`;
    default: return null;
  }
}

export default function HistorialPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const PAGE_SIZE = 100;
  const [rows, setRows] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterEntity, setFilterEntity] = useState<string>("todos");
  const [filterAction, setFilterAction] = useState<string>("todos");
  const [filterUser, setFilterUser] = useState<string>("todos");
  const [days, setDays] = useState<number>(7);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const buildQuery = useCallback((sinceISO: string, beforeISO?: string) => {
    const supabase = createClient();
    let q = supabase
      .from("activity_log")
      .select("*")
      .gte("created_at", sinceISO)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (beforeISO) q = q.lt("created_at", beforeISO);
    if (pais) q = q.eq("ctx_pais", pais);
    if (filterEntity !== "todos") q = q.eq("entity", filterEntity);
    if (filterAction !== "todos") q = q.eq("action", filterAction);
    if (filterUser !== "todos") q = q.eq("user_email", filterUser);
    return q;
  }, [pais, filterEntity, filterAction, filterUser]);

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    setHasMore(false);
    const since = new Date();
    since.setDate(since.getDate() - days);
    const { data, error } = await buildQuery(since.toISOString());
    if (error) { setError(error.message); setRows([]); return; }
    const list = (data ?? []) as LogEntry[];
    setRows(list);
    setHasMore(list.length === PAGE_SIZE);
  }, [buildQuery, days]);

  async function loadMore() {
    if (!rows || rows.length === 0 || loadingMore) return;
    setLoadingMore(true);
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const lastTs = rows[rows.length - 1].created_at;
      const { data, error } = await buildQuery(since.toISOString(), lastTs);
      if (error) { setError(error.message); return; }
      const more = (data ?? []) as LogEntry[];
      setRows([...rows, ...more]);
      setHasMore(more.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => { load(); }, [load]);

  // Lista de usuarios únicos en el período (para el dropdown)
  const usuarios = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows ?? []) if (r.user_email) set.add(r.user_email);
    return [...set].sort();
  }, [rows]);

  function toggle(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Agrupar por día
  const grouped = useMemo(() => {
    const map = new Map<string, LogEntry[]>();
    for (const r of rows ?? []) {
      const day = r.created_at.slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(r);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <>
      <PageHeader
        title="Historial de actividad"
        description="Registro de todas las acciones (crear, modificar, eliminar) hechas por usuarios del workspace"
      />

      {/* Filtros */}
      <div className="card p-4 mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Filter className="w-4 h-4 text-slate-400" />
        <select
          className="select py-1 w-auto"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value="1">Hoy</option>
          <option value="7">Últimos 7 días</option>
          <option value="30">Últimos 30 días</option>
          <option value="90">Últimos 90 días</option>
          <option value="365">Último año</option>
        </select>
        <select className="select py-1 w-auto" value={filterEntity} onChange={(e) => setFilterEntity(e.target.value)}>
          <option value="todos">Todas las entidades</option>
          {Object.entries(ENTITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="select py-1 w-auto" value={filterAction} onChange={(e) => setFilterAction(e.target.value)}>
          <option value="todos">Todas las acciones</option>
          <option value="create">Creó</option>
          <option value="update">Modificó</option>
          <option value="delete">Eliminó</option>
          <option value="restore">Restauró</option>
          <option value="purge">Eliminó definitivamente</option>
        </select>
        <select className="select py-1 w-auto" value={filterUser} onChange={(e) => setFilterUser(e.target.value)}>
          <option value="todos">Todos los usuarios</option>
          {usuarios.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <span className="ml-auto text-xs text-slate-400">
          {rows === null ? "" : `${rows.length} eventos`}
        </span>
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50 text-red-700 mb-4 text-sm">
          {error}
        </div>
      )}

      {rows === null ? (
        <div className="card flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--muted)]" />
        </div>
      ) : rows.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-12 text-center">
          <History className="w-10 h-10 text-slate-300 mb-3" />
          <p className="text-slate-500 text-sm">No hay actividad para los filtros seleccionados</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([day, entries]) => (
            <div key={day} className="card p-0 overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--border)] bg-slate-50/50">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {formatDate(day, country.locale)} · {entries.length} evento{entries.length !== 1 ? "s" : ""}
                </p>
              </div>
              <ul className="divide-y divide-[var(--border)]">
                {entries.map(e => {
                  const meta = ACTION_META[e.action];
                  const Icon = meta.icon;
                  const time = new Date(e.created_at).toLocaleTimeString(country.locale, { hour: "2-digit", minute: "2-digit" });
                  const href = entityHref(e.entity, e.entity_id);
                  const isExpanded = expanded.has(e.id);
                  const hasChanges = e.changes && Object.keys(e.changes).length > 0;

                  return (
                    <li key={e.id}>
                      <div className="px-5 py-3 flex items-start gap-3">
                        <div className={`w-8 h-8 rounded-lg ${meta.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                          <Icon className={`w-4 h-4 ${meta.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">
                            <span className="font-medium text-slate-700">{e.user_email ?? "—"}</span>
                            <span className="text-slate-400 mx-1">·</span>
                            <span className={`font-medium ${meta.color}`}>{meta.label}</span>
                            <span className="text-slate-400 mx-1">en</span>
                            <span className="text-slate-600">{ENTITY_LABELS[e.entity] ?? e.entity}</span>
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {href ? (
                              <Link href={href} className="hover:underline hover:text-[var(--primary)]">
                                {e.entity_label ?? `#${e.entity_id}`}
                              </Link>
                            ) : (
                              <span>{e.entity_label ?? `#${e.entity_id}`}</span>
                            )}
                            <span className="text-slate-300 mx-1">·</span>
                            <span>{time}</span>
                          </p>
                        </div>
                        {hasChanges && (
                          <button
                            onClick={() => toggle(e.id)}
                            className="text-slate-400 hover:text-slate-600 px-2 py-1 rounded hover:bg-slate-100 text-xs flex items-center gap-1"
                          >
                            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            cambios
                          </button>
                        )}
                      </div>
                      {isExpanded && hasChanges && (
                        <div className="px-5 pb-3 ml-11">
                          <pre className="text-[11px] bg-slate-50 border border-[var(--border)] rounded-lg p-3 overflow-x-auto text-slate-600 max-h-80">
{JSON.stringify(e.changes, null, 2)}
                          </pre>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="btn btn-secondary text-sm"
              >
                {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {loadingMore ? "Cargando…" : "Ver más eventos"}
              </button>
            </div>
          )}
          {!hasMore && rows && rows.length > 0 && (
            <p className="text-center text-xs text-slate-400 pt-2">
              Mostrando todos los eventos del período seleccionado.
            </p>
          )}
        </div>
      )}
    </>
  );
}
