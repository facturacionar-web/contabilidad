"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useTable, paisFilter } from "@/lib/useSupabaseData";
import { useConfig } from "@/lib/useConfig";
import { createClient } from "@/lib/supabase/client";
import { formatMoney, formatDate } from "@/lib/format";
import type { ConciliacionMovimiento, Cuenta } from "@/lib/types";
import { findBestMatches, scoreCategory } from "@/lib/conciliacionMatching";
import PageHeader from "@/components/PageHeader";
import ConciliacionImportModal, { type ParsedMovimiento } from "@/components/ConciliacionImportModal";
import {
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Building2,
  ArrowRight,
  Plus,
  EyeOff,
  RefreshCw,
  RotateCcw,
  Check,
  Zap,
} from "lucide-react";

type FilterEstado = "pendientes" | "conciliados" | "ignorados" | "todos";

export default function ConciliacionPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const [cuentaId, setCuentaId] = useState<string>("");
  const [importOpen, setImportOpen] = useState(false);
  const [filterEstado, setFilterEstado] = useState<FilterEstado>("pendientes");
  const [busy, setBusy] = useState<number | null>(null);
  const [matchPickerFor, setMatchPickerFor] = useState<number | null>(null);
  const [movs, setMovs] = useState<ConciliacionMovimiento[]>([]);
  const [movsLoading, setMovsLoading] = useState(false);

  const { data: cuentas } = useTable("cuentas", { filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: pagos } = useTable("gastos", {
    filter: [...(paisFilter(pais) ?? []), { column: "tipo", op: "eq", value: "gasto" }],
    skip: !pais, deps: [pais],
  });
  const { data: ingresos } = useTable("ingresos", { filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: contactos } = useTable("contactos", { filter: paisFilter(pais), skip: !pais, deps: [pais] });

  const cuentaActiva = (cuentas ?? []).find(c => c.id === cuentaId);

  // Auto-seleccionar primera cuenta
  useEffect(() => {
    if (!cuentaId && cuentas && cuentas.length > 0) {
      setCuentaId(cuentas[0].id);
    }
  }, [cuentas, cuentaId]);

  // Cargar movimientos de la cuenta seleccionada
  const loadMovs = useCallback(async () => {
    if (!cuentaId || !pais) return;
    setMovsLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("conciliacion_movimientos")
      .select("*")
      .eq("ctx_pais", pais)
      .eq("cuenta_id", cuentaId)
      .is("deleted_at", null)
      .order("fecha", { ascending: false })
      .order("id", { ascending: false });
    if (error) {
      console.error("[conciliacion] load error:", error);
      setMovs([]);
    } else {
      setMovs((data ?? []) as ConciliacionMovimiento[]);
    }
    setMovsLoading(false);
  }, [cuentaId, pais]);

  useEffect(() => { loadMovs(); }, [loadMovs]);

  // Mapas de matched para el matching (excluir los ya emparejados)
  const matchedIds = useMemo(() => {
    const pagosIds = new Set<number>();
    const ingresosIds = new Set<number>();
    for (const m of movs) {
      if (m.estado === "conciliado" && m.matched_id != null) {
        if (m.matched_type === "pago") pagosIds.add(m.matched_id);
        else if (m.matched_type === "ingreso") ingresosIds.add(m.matched_id);
      }
    }
    return { pagos: pagosIds, ingresos: ingresosIds };
  }, [movs]);

  // Filtrar movimientos según estado seleccionado
  const filteredMovs = useMemo(() => {
    if (filterEstado === "todos") return movs;
    if (filterEstado === "pendientes") return movs.filter(m => m.estado === "pendiente");
    if (filterEstado === "conciliados") return movs.filter(m => m.estado === "conciliado");
    return movs.filter(m => m.estado === "ignorado");
  }, [movs, filterEstado]);

  // Stats
  const stats = useMemo(() => {
    const totalBanco = movs.reduce((s, m) => s + (m.tipo === "credito" ? Number(m.monto) : -Number(m.monto)), 0);
    const conciliados = movs.filter(m => m.estado === "conciliado").length;
    const pendientes = movs.filter(m => m.estado === "pendiente").length;
    const ignorados = movs.filter(m => m.estado === "ignorado").length;
    return { totalBanco, conciliados, pendientes, ignorados, total: movs.length };
  }, [movs]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  async function handleImport(parsed: ParsedMovimiento[]) {
    if (!cuentaActiva || !pais) return;
    const batchId = `${Date.now()}`;
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("No autenticado");
    const effectiveId = (user.user_metadata?.owner_id as string | undefined) ?? user.id;

    // Auto-matching para cada movimiento al importar
    const rows = parsed.map(m => {
      const best = findBestMatches(
        { ...m, cuenta_id: cuentaId },
        pagos ?? [], ingresos ?? [], contactos ?? [],
        matchedIds, 1
      )[0];
      const isAuto = best && scoreCategory(best.score) === "auto";
      return {
        user_id: effectiveId,
        ctx_pais: pais,
        cuenta_id: cuentaId,
        fecha: m.fecha,
        descripcion: m.descripcion,
        referencia: m.referencia,
        monto: m.monto,
        tipo: m.tipo,
        matched_type: isAuto ? best.candidate.type : null,
        matched_id: isAuto ? best.candidate.id : null,
        matched_by: isAuto ? "auto" : null,
        matched_score: best?.score ?? null,
        estado: isAuto ? "conciliado" : "pendiente",
        raw: m as unknown as Record<string, unknown>,
        imported_batch: batchId,
        reconciled_at: isAuto ? new Date().toISOString() : null,
      };
    });

    const { error } = await supabase.from("conciliacion_movimientos").insert(rows as never);
    if (error) throw new Error(error.message);
    await loadMovs();
  }

  async function setEstadoMov(mov: ConciliacionMovimiento, patch: Partial<ConciliacionMovimiento>) {
    setBusy(mov.id);
    const supabase = createClient();
    const { error } = await supabase.from("conciliacion_movimientos")
      .update(patch as never)
      .eq("id", mov.id);
    if (error) {
      alert("Error: " + error.message);
    } else {
      await loadMovs();
    }
    setBusy(null);
  }

  async function confirmMatch(mov: ConciliacionMovimiento, candidate: { type: "pago" | "ingreso"; id: number }, score: number) {
    await setEstadoMov(mov, {
      matched_type: candidate.type,
      matched_id: candidate.id,
      matched_by: "manual",
      matched_score: score,
      estado: "conciliado",
      reconciled_at: new Date().toISOString(),
    });
    setMatchPickerFor(null);
  }

  async function unmatchMov(mov: ConciliacionMovimiento) {
    await setEstadoMov(mov, {
      matched_type: null,
      matched_id: null,
      matched_by: null,
      matched_score: null,
      estado: "pendiente",
      reconciled_at: null,
    });
  }

  async function ignoreMov(mov: ConciliacionMovimiento) {
    await setEstadoMov(mov, {
      estado: "ignorado",
      matched_type: null,
      matched_id: null,
      matched_by: null,
      reconciled_at: null,
    });
  }

  async function autoMatchAll() {
    if (!confirm("Aplicar auto-match a todos los movimientos pendientes? Solo se conciliarán los que tengan match seguro (score ≥ 75).")) return;
    const supabase = createClient();
    const tasks = movs
      .filter(m => m.estado === "pendiente")
      .map(m => {
        const best = findBestMatches(
          { fecha: m.fecha, monto: m.monto, descripcion: m.descripcion, tipo: m.tipo, cuenta_id: m.cuenta_id },
          pagos ?? [], ingresos ?? [], contactos ?? [],
          matchedIds, 1
        )[0];
        if (!best || scoreCategory(best.score) !== "auto") return null;
        return supabase.from("conciliacion_movimientos").update({
          matched_type: best.candidate.type,
          matched_id: best.candidate.id,
          matched_by: "auto",
          matched_score: best.score,
          estado: "conciliado",
          reconciled_at: new Date().toISOString(),
        } as never).eq("id", m.id);
      })
      .filter(Boolean);

    await Promise.all(tasks);
    await loadMovs();
  }

  // ── Render helpers ───────────────────────────────────────────────────────
  function getMatchedRecord(mov: ConciliacionMovimiento) {
    if (!mov.matched_id || !mov.matched_type) return null;
    if (mov.matched_type === "pago") return (pagos ?? []).find(p => p.id === mov.matched_id);
    return (ingresos ?? []).find(i => i.id === mov.matched_id);
  }

  function MatchedDisplay({ mov }: { mov: ConciliacionMovimiento }) {
    const rec = getMatchedRecord(mov);
    if (!rec) {
      return <span className="text-xs text-red-500">⚠ El registro vinculado fue eliminado</span>;
    }
    const proveedor = rec.contacto_id ? (contactos ?? []).find(c => c.id === rec.contacto_id)?.nombre : null;
    const monto = mov.matched_type === "pago" ? Number((rec as { total: number }).total) : Number((rec as { monto: number }).monto);
    const moneda = (rec as { moneda: string }).moneda;
    const href = mov.matched_type === "pago" ? `/egresos/pagos/${rec.id}` : `/ingresos/pagos-recibidos?editar=${rec.id}`;
    return (
      <Link href={href} className="block hover:bg-slate-50 rounded-lg p-2 -m-2">
        <p className="text-xs text-slate-500">
          {mov.matched_type === "pago" ? "Pago" : "Ingreso"} #{rec.id}
          {mov.matched_by === "auto" && <span className="ml-1 text-amber-600">· auto</span>}
          {mov.matched_by === "created" && <span className="ml-1 text-blue-600">· creado</span>}
          {mov.matched_score && <span className="ml-1 text-slate-400">({mov.matched_score} pts)</span>}
        </p>
        <p className="text-sm font-medium text-slate-700 truncate">
          {proveedor ?? rec.concepto}
        </p>
        <p className="text-xs text-slate-500">
          {formatDate(rec.fecha, country.locale)} · {formatMoney(monto, moneda as never, country.locale)}
        </p>
      </Link>
    );
  }

  function MatchPicker({ mov }: { mov: ConciliacionMovimiento }) {
    const matches = useMemo(() => findBestMatches(
      { fecha: mov.fecha, monto: mov.monto, descripcion: mov.descripcion, tipo: mov.tipo, cuenta_id: mov.cuenta_id },
      pagos ?? [], ingresos ?? [], contactos ?? [],
      matchedIds, 8
    ), [mov]);

    if (matches.length === 0) {
      return (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
          No hay {mov.tipo === "debito" ? "pagos" : "ingresos"} candidatos en la app.
          {mov.tipo === "debito" ? (
            <Link href={`/egresos/pagos?nuevo=1&fecha=${mov.fecha}&monto=${mov.monto}&cuenta=${mov.cuenta_id}`} className="ml-1 underline hover:text-amber-900">
              Crear pago →
            </Link>
          ) : (
            <Link href={`/ingresos/pagos-recibidos?nuevo=1&fecha=${mov.fecha}&monto=${mov.monto}&cuenta=${mov.cuenta_id}`} className="ml-1 underline hover:text-amber-900">
              Crear ingreso →
            </Link>
          )}
        </div>
      );
    }

    return (
      <div className="bg-white border border-[var(--border)] rounded-lg shadow-sm p-2 space-y-1 max-h-64 overflow-y-auto">
        {matches.map(m => {
          const cat = scoreCategory(m.score);
          const c = m.candidate;
          return (
            <button
              key={`${c.type}-${c.id}`}
              onClick={() => confirmMatch(mov, c, m.score)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center justify-between gap-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {c.proveedor_nombre ?? c.concepto}
                </p>
                <p className="text-xs text-slate-500">
                  {c.type === "pago" ? "Pago" : "Ingreso"} #{c.id} · {c.fecha} · {formatMoney(c.monto, cuentaActiva?.moneda ?? "ARS" as never, country.locale)}
                </p>
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                cat === "auto" ? "bg-emerald-100 text-emerald-700" :
                cat === "candidato" ? "bg-amber-100 text-amber-700" :
                "bg-slate-100 text-slate-500"
              }`}>
                {m.score}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!pais) return null;

  return (
    <>
      <PageHeader
        title="Conciliación bancaria"
        description="Importá extractos y conciliá los movimientos del banco con tus pagos e ingresos"
        action={cuentaActiva && (
          <button onClick={() => setImportOpen(true)} className="btn btn-primary">
            <Upload className="w-4 h-4" /> Importar extracto
          </button>
        )}
      />

      {/* Selector de cuenta */}
      <div className="card mb-4 flex flex-wrap items-center gap-3">
        <Building2 className="w-5 h-5 text-[var(--primary)]" />
        <span className="text-sm font-medium">Cuenta:</span>
        <select
          value={cuentaId}
          onChange={e => setCuentaId(e.target.value)}
          className="select w-auto"
        >
          {(cuentas ?? []).map(c => (
            <option key={c.id} value={c.id}>{c.nombre} — {c.tipo} · {c.moneda}</option>
          ))}
        </select>
        {(cuentas ?? []).length === 0 && (
          <span className="text-xs text-slate-400">
            No tenés cuentas. <Link href="/cuentas" className="text-[var(--primary)] hover:underline">Crear una</Link>
          </span>
        )}
      </div>

      {cuentaActiva && stats.total > 0 && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <StatBox label="Total movimientos" value={stats.total.toString()} />
            <StatBox label="Conciliados" value={stats.conciliados.toString()} color="text-emerald-600" />
            <StatBox label="Pendientes" value={stats.pendientes.toString()} color="text-amber-600" />
            <StatBox label="Ignorados" value={stats.ignorados.toString()} color="text-slate-500" />
            <StatBox
              label="Saldo movs"
              value={formatMoney(stats.totalBanco, cuentaActiva.moneda, country.locale)}
              color={stats.totalBanco >= 0 ? "text-emerald-600" : "text-red-600"}
            />
          </div>

          {/* Filtros + acciones */}
          <div className="card mb-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              {(["pendientes","conciliados","ignorados","todos"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilterEstado(f)}
                  className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                    filterEstado === f ? "bg-white text-slate-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {f === "pendientes" ? `Pendientes (${stats.pendientes})` :
                   f === "conciliados" ? `Conciliados (${stats.conciliados})` :
                   f === "ignorados" ? `Ignorados (${stats.ignorados})` :
                   `Todos (${stats.total})`}
                </button>
              ))}
            </div>
            <button onClick={autoMatchAll} className="btn btn-secondary text-sm">
              <Zap className="w-3.5 h-3.5" /> Auto-conciliar pendientes
            </button>
          </div>
        </>
      )}

      {/* Lista de movimientos */}
      {!cuentaActiva ? null : movsLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--muted)]" />
        </div>
      ) : stats.total === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <Upload className="w-10 h-10 text-slate-300 mb-3" />
          <p className="font-medium text-slate-600 mb-1">No hay movimientos importados aún</p>
          <p className="text-sm text-slate-400 mb-4">Subí un extracto de la cuenta para empezar a conciliar</p>
          <button onClick={() => setImportOpen(true)} className="btn btn-primary">
            <Upload className="w-4 h-4" /> Importar extracto
          </button>
        </div>
      ) : filteredMovs.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-300 mb-3" />
          <p className="text-sm text-slate-500">No hay movimientos en este filtro</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredMovs.map(mov => {
            const isPicker = matchPickerFor === mov.id;
            const isBusy = busy === mov.id;
            return (
              <div
                key={mov.id}
                className={`card p-0 overflow-visible ${
                  mov.estado === "conciliado" ? "border-l-4 border-l-emerald-400" :
                  mov.estado === "ignorado" ? "opacity-60 border-l-4 border-l-slate-300" :
                  "border-l-4 border-l-amber-400"
                }`}
              >
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr_auto] gap-4 items-center p-4">
                  {/* Movimiento del banco */}
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-0.5">Banco</p>
                    <p className="text-sm font-medium text-slate-700 truncate">
                      {mov.descripcion || <em className="text-slate-400">Sin descripción</em>}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                      <span>{formatDate(mov.fecha, country.locale)}</span>
                      <span>·</span>
                      <span className={`font-semibold ${mov.tipo === "credito" ? "text-emerald-600" : "text-red-600"}`}>
                        {mov.tipo === "credito" ? "+" : "−"} {formatMoney(Number(mov.monto), cuentaActiva!.moneda, country.locale)}
                      </span>
                      {mov.referencia && <><span>·</span><span className="font-mono text-[10px]">{mov.referencia}</span></>}
                    </div>
                  </div>

                  {/* Estado */}
                  <div className="text-center hidden lg:block">
                    {mov.estado === "conciliado" ? (
                      <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto" />
                    ) : mov.estado === "ignorado" ? (
                      <EyeOff className="w-6 h-6 text-slate-400 mx-auto" />
                    ) : (
                      <ArrowRight className="w-6 h-6 text-amber-500 mx-auto" />
                    )}
                  </div>

                  {/* App side */}
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-0.5">En la app</p>
                    {mov.estado === "conciliado" ? (
                      <MatchedDisplay mov={mov} />
                    ) : mov.estado === "ignorado" ? (
                      <p className="text-xs text-slate-400 italic">Movimiento ignorado</p>
                    ) : isPicker ? (
                      <MatchPicker mov={mov} />
                    ) : (
                      <button
                        onClick={() => setMatchPickerFor(mov.id)}
                        className="text-xs text-[var(--primary)] hover:underline"
                      >
                        Buscar match…
                      </button>
                    )}
                  </div>

                  {/* Acciones */}
                  <div className="flex items-center gap-1 justify-end">
                    {isBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                    ) : mov.estado === "conciliado" ? (
                      <button
                        onClick={() => unmatchMov(mov)}
                        className="btn btn-ghost p-1.5 text-slate-500"
                        title="Deshacer match"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    ) : mov.estado === "ignorado" ? (
                      <button
                        onClick={() => unmatchMov(mov)}
                        className="btn btn-ghost p-1.5 text-slate-500"
                        title="Reactivar"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    ) : (
                      <>
                        {!isPicker && (
                          <button
                            onClick={() => setMatchPickerFor(mov.id)}
                            className="btn btn-ghost p-1.5 text-blue-600"
                            title="Buscar match"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        )}
                        <Link
                          href={mov.tipo === "debito"
                            ? `/egresos/pagos?nuevo=1&fecha=${mov.fecha}&monto=${mov.monto}&cuenta=${mov.cuenta_id}&conciliar=${mov.id}`
                            : `/ingresos/pagos-recibidos?nuevo=1&fecha=${mov.fecha}&monto=${mov.monto}&cuenta=${mov.cuenta_id}&conciliar=${mov.id}`}
                          className="btn btn-ghost p-1.5 text-emerald-600"
                          title={mov.tipo === "debito" ? "Crear pago" : "Crear ingreso"}
                        >
                          <Plus className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={() => ignoreMov(mov)}
                          className="btn btn-ghost p-1.5 text-slate-500"
                          title="Ignorar"
                        >
                          <EyeOff className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {isPicker && (
                  <div className="px-4 pb-3 flex justify-end">
                    <button
                      onClick={() => setMatchPickerFor(null)}
                      className="text-xs text-slate-400 hover:text-slate-600"
                    >
                      Cerrar
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {cuentaActiva && (
        <ConciliacionImportModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          cuenta={cuentaActiva as Cuenta}
          onConfirm={handleImport}
        />
      )}
    </>
  );
}

function StatBox({ label, value, color = "text-slate-700" }: { label: string; value: string; color?: string }) {
  return (
    <div className="card py-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className={`text-lg font-semibold mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}
