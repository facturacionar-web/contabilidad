"use client";
import { useState, useMemo, useCallback } from "react";
import { useTable, paisFilter } from "@/lib/useSupabaseData";
import { useConfig } from "@/lib/useConfig";
import { CurrencyCode } from "@/lib/countries";
import { formatMoney } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import Link from "next/link";
import { ChevronDown, ChevronRight, Search, Package, Settings2, AlertCircle, CheckCircle2, Copy, History } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import {
  PAISES, CUENTAS,
  type PaisKey, type CuentaKey, type DistCuentas, type ConceptoConfig,
  defaultDistCuentas, defaultConfig, hasConfig, loadConfig, saveConfig,
  applyTemplateToPayments, hasSnapshot,
} from "@/lib/proveedoresConfig";

// ── Tipos locales ─────────────────────────────────────────────────────────────

type ConceptoStat = { total: number; count: number; pagoIds: number[] };

const SIN_PROVEEDOR = 0;

// ── Validaciones ──────────────────────────────────────────────────────────────

function sumPais(d: Record<PaisKey, number>): number {
  return PAISES.reduce((s, p) => s + (Number(d[p]) || 0), 0);
}
function sumCuentas(d: DistCuentas): number {
  return CUENTAS.reduce((s, c) => s + (Number(d[c.key]) || 0), 0);
}

type ValidationResult = {
  paisError: string | null;
  cuentasError: Record<PaisKey, string | null>;
  valid: boolean;
};

const TOLERANCIA = 1; // acepta sumas entre 99% y 101%

function cerca100(suma: number): boolean {
  return Math.abs(suma - 100) <= TOLERANCIA;
}

/** Normaliza un Record para que sume exactamente 100%, distribuyendo el resto en el valor más grande */
function normalizar100<K extends string>(dist: Record<K, number>, keys: readonly K[]): Record<K, number> {
  const total = keys.reduce((s, k) => s + (dist[k] || 0), 0);
  if (total === 0 || Math.abs(total - 100) < 0.001) return dist;
  const factor = 100 / total;
  const result = { ...dist } as Record<K, number>;
  // Ordenar de mayor a menor; ajustar todos menos el primero (el mayor absorbe el resto)
  const sorted = [...keys].sort((a, b) => (dist[b] || 0) - (dist[a] || 0));
  let acum = 0;
  sorted.slice(0, -1).forEach(k => {
    result[k] = parseFloat(((dist[k] || 0) * factor).toFixed(2));
    acum += result[k];
  });
  result[sorted[sorted.length - 1]] = parseFloat((100 - acum).toFixed(2));
  return result;
}

function validate(cfg: ConceptoConfig): ValidationResult {
  const totalPais = sumPais(cfg.dist_pais);
  const paisError = !cerca100(totalPais)
    ? `La distribución por país suma ${totalPais.toFixed(2)}%, debe ser 100%`
    : null;

  const cuentasError: Record<PaisKey, string | null> = { ARG: null, MEX: null, CHILE: null };
  for (const pais of PAISES) {
    // Si prorrateo está activo o el país no tiene asignación, no validar cuentas
    if (cfg.dist_pais[pais] > 0 && !cfg.prorrateo[pais]) {
      const s = sumCuentas(cfg.dist_cuentas[pais]);
      if (!cerca100(s)) {
        cuentasError[pais] = `Suma ${s.toFixed(2)}%, debe ser 100%`;
      }
    }
  }
  const valid = !paisError && PAISES.every(p => !cuentasError[p]);
  return { paisError, cuentasError, valid };
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function ProveedoresPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const base = (config?.moneda_base ?? "ARS") as CurrencyCode;

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");

  // Estado del modal de edición
  type EditTarget = { contactoId: number; concepto: string; proveedorNombre: string } | null;
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [editForm, setEditForm] = useState<ConceptoConfig>(defaultConfig());
  const [expandedPaises, setExpandedPaises] = useState<Set<PaisKey>>(new Set(["ARG"]));
  const [saveCount, setSaveCount] = useState(0); // fuerza re-render tras guardar
  const [copiarDe, setCopiarDe] = useState(""); // nombre del concepto del que copiar
  const [pendingRetro, setPendingRetro] = useState<{ cfg: ConceptoConfig; contactoId: number; concepto: string; pagoIds: number[] } | null>(null);
  const [retroSelectMode, setRetroSelectMode] = useState(false);
  const [retroSelected, setRetroSelected] = useState<Set<number>>(new Set());
  const [retroFechaDesde, setRetroFechaDesde] = useState("");

  const { data: contactos } = useTable("contactos", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });
  const { data: gastos } = useTable("gastos", {
    orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais],
  });

  const proveedores = useMemo(
    () => (contactos ?? []).filter(c => c.tipo === "proveedor" || c.tipo === "ambos"),
    [contactos]
  );

  const conceptosPorProveedor = useMemo(() => {
    const result: Record<number, Record<string, ConceptoStat>> = {};
    for (const g of (gastos ?? [])) {
      const contactoKey: number = g.contacto_id ?? SIN_PROVEEDOR;
      const items = Array.isArray(g.items)
        ? (g.items as { concepto_nombre?: string; total?: number }[])
        : [];
      const fps = Array.isArray(g.factura_pagos) ? g.factura_pagos : [];
      const esPagoFactura = fps.length > 0;
      if (items.length === 0 && (esPagoFactura || g.tipo === "factura_proveedor")) continue;
      const tasa = Number(g.tasa_cambio) || 1;
      if (!result[contactoKey]) result[contactoKey] = {};
      const map = result[contactoKey];
      if (items.length > 0) {
        const vistos = new Set<string>();
        for (const item of items) {
          const nombre = item.concepto_nombre?.trim();
          if (!nombre) continue;
          const montoBase = g.moneda === base ? Number(item.total ?? 0) : Number(item.total ?? 0) * tasa;
          if (!map[nombre]) map[nombre] = { total: 0, count: 0, pagoIds: [] };
          map[nombre].total += montoBase;
          if (!vistos.has(nombre)) { map[nombre].count++; vistos.add(nombre); }
          if (!map[nombre].pagoIds.includes(g.id)) map[nombre].pagoIds.push(g.id);
        }
      } else {
        const nombre = (g.concepto as string | undefined)?.trim();
        if (!nombre) continue;
        const montoBase = g.moneda === base ? Number(g.total ?? 0) : Number(g.total ?? 0) * tasa;
        if (!map[nombre]) map[nombre] = { total: 0, count: 0, pagoIds: [] };
        map[nombre].total += montoBase;
        map[nombre].count++;
        if (!map[nombre].pagoIds.includes(g.id)) map[nombre].pagoIds.push(g.id);
      }
    }
    return result;
  }, [gastos, base]);

  const proveedoresConGastos = useMemo(() =>
    proveedores
      .filter(p => !!conceptosPorProveedor[p.id])
      .filter(p => !search || p.nombre.toLowerCase().includes(search.toLowerCase())),
    [proveedores, conceptosPorProveedor, search]
  );

  const conceptosSinProveedor = conceptosPorProveedor[SIN_PROVEEDOR] ?? null;
  const nombresSinProveedor = conceptosSinProveedor ? Object.keys(conceptosSinProveedor).sort() : [];
  const sinProveedorVisible = !!conceptosSinProveedor && (!search || "sin proveedor".includes(search.toLowerCase()));
  const hayDatos = proveedoresConGastos.length > 0 || sinProveedorVisible;

  function toggle(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function closePendingRetro() {
    setPendingRetro(null);
    setRetroSelectMode(false);
    setRetroSelected(new Set());
    setRetroFechaDesde("");
  }

  function enterSelectMode() {
    if (!pendingRetro) return;
    setRetroSelected(new Set(pendingRetro.pagoIds)); // arranca todo seleccionado
    setRetroFechaDesde("");
    setRetroSelectMode(true);
  }

  function openEdit(contactoId: number, concepto: string, proveedorNombre: string) {
    setEditTarget({ contactoId, concepto, proveedorNombre });
    setEditForm(loadConfig(contactoId, concepto));
    setExpandedPaises(new Set(["ARG"]));
    setCopiarDe("");
  }

  /**
   * Re-sincroniza los pagos afectados al Sheet con la nueva config.
   * Se llama justo después de guardar la config en Gastos por proveedor.
   */
  const resyncPagosParaConcepto = useCallback((
    pagoIds: number[],
    concepto: string,
    cfg: ConceptoConfig,
    contactoId: number,
  ) => {
    for (const pagoId of pagoIds) {
      const gasto = (gastos ?? []).find(g => g.id === pagoId);
      if (!gasto) continue;

      const contactoNombre = (contactos ?? []).find(c => c.id === gasto.contacto_id)?.nombre ?? "";
      const tipo_sync = gasto.tipo === "factura_proveedor" ? "factura" : "pago";

      // Obtener nombres de conceptos del pago/factura
      const items = Array.isArray((gasto as unknown as { items?: unknown[] }).items)
        ? (gasto as unknown as { items: { concepto_nombre?: string }[] }).items
        : [];
      const conceptNames: string[] = items.length > 0
        ? [...new Set(items.map(it => it.concepto_nombre).filter((n): n is string => !!n))]
        : [(gasto.concepto as string | undefined) ?? ""].filter(Boolean);

      // Construir dist_configs: config actualizada para el concepto editado, template para el resto
      const dist_configs: Record<string, ConceptoConfig> = {};
      for (const nombre of conceptNames) {
        if (nombre === concepto) {
          dist_configs[nombre] = cfg;
        } else if (hasConfig(contactoId, nombre)) {
          dist_configs[nombre] = loadConfig(contactoId, nombre);
        }
      }

      fetch("/api/sync-factura", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(gasto as unknown as Record<string, unknown>),
          id: pagoId,
          proveedor: contactoNombre,
          tipo_sync,
          dist_configs,
        }),
      }).catch(e => console.error("[resync] pago", pagoId, e));
    }
  }, [gastos, contactos]);

  function handleSave() {
    const v = validate(editForm);
    if (!v.valid) return;
    if (!editTarget) return;

    // Normalizar a exactamente 100% antes de guardar
    const cuentaKeys = CUENTAS.map(c => c.key) as CuentaKey[];
    const cfgNormalizada: ConceptoConfig = {
      ...editForm,
      dist_pais: normalizar100(editForm.dist_pais, PAISES),
      dist_cuentas: {
        ARG:   (editForm.dist_pais.ARG   > 0 && !editForm.prorrateo.ARG)   ? normalizar100(editForm.dist_cuentas.ARG,   cuentaKeys) : editForm.dist_cuentas.ARG,
        MEX:   (editForm.dist_pais.MEX   > 0 && !editForm.prorrateo.MEX)   ? normalizar100(editForm.dist_cuentas.MEX,   cuentaKeys) : editForm.dist_cuentas.MEX,
        CHILE: (editForm.dist_pais.CHILE > 0 && !editForm.prorrateo.CHILE) ? normalizar100(editForm.dist_cuentas.CHILE, cuentaKeys) : editForm.dist_cuentas.CHILE,
      },
    };

    setEditTarget(null);

    // Preguntar si aplicar a pagos anteriores (si los hay).
    // saveConfig se llama solo cuando el usuario elige una opción — si recarga sin elegir, los cambios se descartan.
    const stat = conceptosPorProveedor[editTarget.contactoId]?.[editTarget.concepto];
    if (stat?.pagoIds?.length) {
      setPendingRetro({
        cfg: cfgNormalizada,
        contactoId: editTarget.contactoId,
        concepto: editTarget.concepto,
        pagoIds: stat.pagoIds,
      });
    } else {
      // Sin pagos anteriores: guardar directamente sin modal
      saveConfig(editTarget.contactoId, editTarget.concepto, cfgNormalizada);
      setSaveCount(c => c + 1);
    }
  }

  function setPaisValue(pais: PaisKey, val: number) {
    setEditForm(f => ({ ...f, dist_pais: { ...f.dist_pais, [pais]: val } }));
  }

  function setCuentaValue(pais: PaisKey, cuenta: CuentaKey, val: number) {
    setEditForm(f => ({
      ...f,
      dist_cuentas: {
        ...f.dist_cuentas,
        [pais]: { ...f.dist_cuentas[pais], [cuenta]: val },
      },
    }));
  }

  function togglePais(p: PaisKey) {
    setExpandedPaises(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  const validation = editForm ? validate(editForm) : null;

  // ── Tabla de conceptos ─────────────────────────────────────────────────────

  function ConceptosTable({ contactoId, conceptos, nombres, label }: {
    contactoId: number;
    conceptos: Record<string, ConceptoStat>;
    nombres: string[];
    label: string;
  }) {
    const sinConfig = nombres.filter(n => !hasConfig(contactoId, n));
    return (
      <div className="border-t border-[var(--border)] bg-slate-50/40">
        {sinConfig.length > 0 && (
          <div className="flex items-center gap-2 px-12 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-700">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span><strong>{sinConfig.length}</strong> concepto{sinConfig.length !== 1 ? "s" : ""} sin porcentajes configurados</span>
          </div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="text-left px-12 py-2 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Concepto</th>
              <th className="text-center px-5 py-2 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Usos</th>
              <th className="text-right px-5 py-2 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Total ({base})</th>
              <th className="w-28 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {nombres.map(nombre => {
              const stat = conceptos[nombre];
              const configured = hasConfig(contactoId, nombre);
              return (
                <tr key={nombre} className="hover:bg-slate-50 group">
                  <td className="px-12 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{nombre}</span>
                      {configured
                        ? <span title="Configurado" className="inline-flex"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" /></span>
                        : <span title="Sin configurar" className="inline-flex"><AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" /></span>}
                    </div>
                  </td>
                  <td className="px-5 py-2.5 text-center text-[var(--muted)]">{stat.count}</td>
                  <td className="px-5 py-2.5 text-right font-semibold text-red-600">
                    {formatMoney(stat.total, base, country.locale)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      className={`btn btn-ghost p-1.5 transition-opacity text-[var(--muted)] hover:text-[var(--primary)] ${configured ? "opacity-0 group-hover:opacity-100" : "opacity-100"}`}
                      title="Configurar porcentajes"
                      onClick={() => openEdit(contactoId, nombre, label)}
                    >
                      <Settings2 className={`w-3.5 h-3.5 ${!configured ? "text-amber-500" : ""}`} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--border)] bg-[var(--surface-hover)]">
              <td className="px-12 py-2.5 font-semibold text-[var(--foreground)]" colSpan={3}>Total {label}</td>
              <td className="px-5 py-2.5 text-right font-bold text-base text-red-500">
                {formatMoney(nombres.reduce((s, n) => s + conceptos[n].total, 0), base, country.locale)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <PageHeader
        title="Gastos por proveedor"
        description="Conceptos utilizados por proveedor en facturas y pagos"
      />

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input pl-9 sm:w-72"
              placeholder="Buscar proveedor…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <span className="text-sm text-[var(--muted)]">
            {proveedoresConGastos.length} proveedor{proveedoresConGastos.length !== 1 ? "es" : ""}
            {sinProveedorVisible && " + sin asignar"}
          </span>
        </div>

        {!hayDatos ? (
          <EmptyState
            icon={<Package className="w-6 h-6" />}
            title="Sin proveedores con movimientos"
            description="Cuando registres facturas o pagos a proveedores, aparecerán aquí con sus conceptos."
          />
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {proveedoresConGastos.map(p => {
              const conceptos = conceptosPorProveedor[p.id] ?? {};
              const isOpen = expanded.has(p.id);
              const nombres = Object.keys(conceptos).sort();
              return (
                <div key={p.id}>
                  <button
                    className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition-colors text-left"
                    onClick={() => toggle(p.id)}
                  >
                    {isOpen
                      ? <ChevronDown className="w-4 h-4 shrink-0 text-[var(--muted)]" />
                      : <ChevronRight className="w-4 h-4 shrink-0 text-[var(--muted)]" />}
                    <Link
                      href={`/contactos/${p.id}`}
                      className="font-semibold hover:underline hover:text-[var(--primary)]"
                      onClick={e => e.stopPropagation()}
                    >
                      {p.nombre}
                    </Link>
                    {p.tax_id && <span className="text-xs text-[var(--muted)]">{p.tax_id}</span>}
                    {(() => {
                      const sinCfg = nombres.filter(n => !hasConfig(p.id, n)).length;
                      return (
                        <span className="ml-auto flex items-center gap-2 text-xs">
                          {sinCfg > 0 && (
                            <span className="flex items-center gap-1 text-amber-600 font-medium">
                              <AlertCircle className="w-3.5 h-3.5" />
                              {sinCfg} sin config
                            </span>
                          )}
                          <span className="text-[var(--muted)]">{nombres.length} concepto{nombres.length !== 1 ? "s" : ""}</span>
                        </span>
                      );
                    })()}
                  </button>
                  {isOpen && (
                    <ConceptosTable
                      contactoId={p.id}
                      conceptos={conceptos}
                      nombres={nombres}
                      label={p.nombre}
                    />
                  )}
                </div>
              );
            })}

            {sinProveedorVisible && conceptosSinProveedor && (
              <div>
                <button
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition-colors text-left"
                  onClick={() => toggle(SIN_PROVEEDOR)}
                >
                  {expanded.has(SIN_PROVEEDOR)
                    ? <ChevronDown className="w-4 h-4 shrink-0 text-[var(--muted)]" />
                    : <ChevronRight className="w-4 h-4 shrink-0 text-[var(--muted)]" />}
                  <span className="font-semibold text-[var(--muted)] italic">Sin proveedor asignado</span>
                  <span className="ml-auto text-xs text-[var(--muted)]">
                    {nombresSinProveedor.length} concepto{nombresSinProveedor.length !== 1 ? "s" : ""}
                  </span>
                </button>
                {expanded.has(SIN_PROVEEDOR) && (
                  <ConceptosTable
                    contactoId={SIN_PROVEEDOR}
                    conceptos={conceptosSinProveedor}
                    nombres={nombresSinProveedor}
                    label="sin proveedor"
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Modal de configuración ── */}
      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={editTarget ? `Configurar: ${editTarget.concepto}` : ""}
        size="xl"
      >
        {editTarget && validation && (
          <div className="space-y-6">
            <p className="text-sm text-[var(--muted)]">
              Proveedor: <span className="font-medium text-[var(--foreground)]">{editTarget.proveedorNombre}</span>
            </p>

            {/* ── Copiar de otro concepto ── */}
            {(() => {
              const conceptosDelProveedor = Object.keys(conceptosPorProveedor[editTarget.contactoId] ?? {})
                .filter(n => n !== editTarget.concepto && hasConfig(editTarget.contactoId, n));
              if (conceptosDelProveedor.length === 0) return null;
              return (
                <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                  <Copy className="w-4 h-4 text-blue-500 shrink-0" />
                  <span className="text-sm text-blue-700 font-medium whitespace-nowrap">Copiar de:</span>
                  <select
                    className="select text-sm py-1 flex-1"
                    value={copiarDe}
                    onChange={e => {
                      const origen = e.target.value;
                      setCopiarDe(origen);
                      if (origen) setEditForm(loadConfig(editTarget.contactoId, origen));
                    }}
                  >
                    <option value="">— Elegir concepto —</option>
                    {conceptosDelProveedor.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              );
            })()}

            {/* ── 1. Configuración general ── */}
            <section>
              <h3 className="text-sm font-semibold mb-3 pb-2 border-b border-[var(--border)]">
                Configuración general
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Operativo</label>
                  <select
                    className="select"
                    value={editForm.operativo ? "si" : "no"}
                    onChange={e => setEditForm(f => ({ ...f, operativo: e.target.value === "si" }))}
                  >
                    <option value="si">Sí</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div>
                  <label className="label">Incluir</label>
                  <select
                    className="select"
                    value={editForm.incluir ? "si" : "no"}
                    onChange={e => setEditForm(f => ({ ...f, incluir: e.target.value === "si" }))}
                  >
                    <option value="si">Sí</option>
                    <option value="no">No</option>
                  </select>
                </div>
              </div>
            </section>

            {/* ── 2. Distribución por país ── */}
            <section>
              <h3 className="text-sm font-semibold mb-3 pb-2 border-b border-[var(--border)]">
                Distribución por país
              </h3>
              <div className="space-y-2">
                {PAISES.map(p => (
                  <div key={p} className="flex items-center gap-3">
                    <span className="w-14 text-sm font-medium">{p}</span>
                    <div className="relative flex-1 max-w-[160px]">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        className="input pr-8"
                        value={editForm.dist_pais[p] || ""}
                        placeholder="0"
                        onChange={e => setPaisValue(p, parseFloat(e.target.value) || 0)}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--muted)]">%</span>
                    </div>
                  </div>
                ))}

                {/* Total y validación */}
                <div className={`flex items-center gap-2 pt-2 text-sm font-medium ${
                  validation.paisError ? "text-red-600" : "text-green-600"
                }`}>
                  {validation.paisError
                    ? <AlertCircle className="w-4 h-4 shrink-0" />
                    : <CheckCircle2 className="w-4 h-4 shrink-0" />}
                  <span>
                    Total: {sumPais(editForm.dist_pais).toFixed(2)}%
                    {validation.paisError && ` — ${validation.paisError}`}
                  </span>
                </div>
              </div>
            </section>

            {/* ── 3. Distribución por cuentas (por país) ── */}
            <section>
              <h3 className="text-sm font-semibold mb-3 pb-2 border-b border-[var(--border)]">
                Distribución por cuentas
              </h3>
              <div className="space-y-2">
                {PAISES.map(p => {
                  const isOpen = expandedPaises.has(p);
                  const totalCuentas = sumCuentas(editForm.dist_cuentas[p]);
                  const cuentaError = validation.cuentasError[p];
                  const aplica = editForm.dist_pais[p] > 0;

                  return (
                    <div key={p} className="border border-[var(--border)] rounded-lg overflow-hidden">
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                        onClick={() => togglePais(p)}
                      >
                        {isOpen
                          ? <ChevronDown className="w-3.5 h-3.5 text-[var(--muted)]" />
                          : <ChevronRight className="w-3.5 h-3.5 text-[var(--muted)]" />}
                        <span className="font-medium text-sm flex-1">{p}</span>
                        {!aplica && (
                          <span className="text-xs text-[var(--muted)]">sin asignación de país</span>
                        )}
                        {aplica && (
                          <span className={`text-xs font-medium ${cuentaError ? "text-red-600" : "text-green-600"}`}>
                            {totalCuentas.toFixed(2)}%
                          </span>
                        )}
                      </button>

                      {isOpen && (
                        <div className="px-4 py-3 space-y-3 bg-white">
                          {!aplica && (
                            <p className="text-xs text-[var(--muted)] italic py-1">
                              Este país tiene 0% de distribución. La configuración de cuentas no aplica.
                            </p>
                          )}

                          {/* Prorrateo SI/NO */}
                          {aplica && (
                            <div className="flex items-center gap-3 pb-2 border-b border-[var(--border)]">
                              <span className="text-sm font-medium w-44">Prorrateo</span>
                              <select
                                className="select w-28 text-sm py-1"
                                value={editForm.prorrateo[p] ? "si" : "no"}
                                onChange={e => setEditForm(f => ({
                                  ...f,
                                  prorrateo: { ...f.prorrateo, [p]: e.target.value === "si" },
                                }))}
                              >
                                <option value="no">No</option>
                                <option value="si">Sí</option>
                              </select>
                              {editForm.prorrateo[p] && (
                                <span className="text-xs text-[var(--muted)]">
                                  Se distribuirá automáticamente entre cuentas
                                </span>
                              )}
                            </div>
                          )}

                          {/* Porcentajes por cuenta (ocultos si prorrateo = SI) */}
                          {aplica && !editForm.prorrateo[p] && (
                            <>
                              {CUENTAS.map(c => (
                                <div key={c.key} className="flex items-center gap-3">
                                  <span className="w-44 text-sm text-[var(--muted)]">{c.label}</span>
                                  <div className="relative max-w-[140px]">
                                    <input
                                      type="number"
                                      min={0}
                                      max={100}
                                      step={0.01}
                                      className="input pr-8"
                                      value={editForm.dist_cuentas[p][c.key] || ""}
                                      placeholder="0"
                                      onChange={e => setCuentaValue(p, c.key, parseFloat(e.target.value) || 0)}
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--muted)]">%</span>
                                  </div>
                                </div>
                              ))}
                              <div className={`flex items-center gap-2 pt-1 text-xs font-medium ${
                                cuentaError ? "text-red-600" : "text-green-600"
                              }`}>
                                {cuentaError
                                  ? <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                  : <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                                <span>
                                  Total: {sumCuentas(editForm.dist_cuentas[p]).toFixed(2)}%
                                  {cuentaError && ` — ${cuentaError}`}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ── Acciones ── */}
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <button className="btn btn-secondary" onClick={() => setEditTarget(null)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={!validation.valid}
                title={!validation.valid ? "Corregí los errores antes de guardar" : undefined}
              >
                Guardar
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Modal: ¿Aplicar a pagos anteriores? ── */}
      <Modal
        open={!!pendingRetro}
        onClose={closePendingRetro}
        title="¿Aplicar a pagos anteriores?"
        size="lg"
      >
        {pendingRetro && !retroSelectMode && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
              <History className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800">
                <p className="font-semibold mb-1">
                  Hay {pendingRetro.pagoIds.length} pago{pendingRetro.pagoIds.length !== 1 ? "s" : ""} anteriores con <strong>{pendingRetro.concepto}</strong>
                </p>
                <p>¿Querés aplicar esta nueva configuración a esos pagos?</p>
              </div>
            </div>
            <p className="text-sm text-[var(--muted)]">
              <strong>Solo futuros</strong>: los pagos anteriores conservan su distribución en el Sheet.<br />
              <strong>Seleccionar</strong>: elegís a partir de qué fecha o cuáles pagos actualizar.<br />
              <strong>Aplicar a todos</strong>: actualiza todos los pagos anteriores en el Sheet.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  saveConfig(pendingRetro.contactoId, pendingRetro.concepto, pendingRetro.cfg);
                  setSaveCount(c => c + 1);
                  closePendingRetro();
                }}
              >
                Solo futuros
              </button>
              <button className="btn btn-secondary" onClick={enterSelectMode}>
                Seleccionar…
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  saveConfig(pendingRetro.contactoId, pendingRetro.concepto, pendingRetro.cfg);
                  applyTemplateToPayments(pendingRetro.contactoId, pendingRetro.concepto, pendingRetro.cfg, pendingRetro.pagoIds);
                  resyncPagosParaConcepto(pendingRetro.pagoIds, pendingRetro.concepto, pendingRetro.cfg, pendingRetro.contactoId);
                  setSaveCount(c => c + 1);
                  closePendingRetro();
                }}
              >
                Aplicar a todos ({pendingRetro.pagoIds.length})
              </button>
            </div>
          </div>
        )}

        {pendingRetro && retroSelectMode && (
          <div className="space-y-4">
            {/* Filtro por fecha */}
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium whitespace-nowrap">Aplicar desde:</label>
              <input
                type="date"
                className="input w-40 text-sm"
                value={retroFechaDesde}
                onChange={e => {
                  const fecha = e.target.value;
                  setRetroFechaDesde(fecha);
                  const next = new Set<number>();
                  for (const id of pendingRetro.pagoIds) {
                    const g = (gastos ?? []).find(g => g.id === id);
                    if (g && (!fecha || (g.fecha as string) >= fecha)) next.add(id);
                  }
                  setRetroSelected(next);
                }}
              />
              <div className="ml-auto flex gap-3">
                <button
                  className="text-xs text-[var(--primary)] hover:underline"
                  onClick={() => { setRetroSelected(new Set(pendingRetro.pagoIds)); setRetroFechaDesde(""); }}
                >
                  Todos
                </button>
                <button
                  className="text-xs text-[var(--muted)] hover:underline"
                  onClick={() => { setRetroSelected(new Set()); setRetroFechaDesde(""); }}
                >
                  Ninguno
                </button>
              </div>
            </div>

            {/* Lista de pagos con checkboxes */}
            <div className="max-h-64 overflow-y-auto border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
              {pendingRetro.pagoIds
                .map(id => ({ id, g: (gastos ?? []).find(g => g.id === id) }))
                .sort((a, b) => ((b.g?.fecha as string) ?? "").localeCompare((a.g?.fecha as string) ?? ""))
                .map(({ id, g }) => {
                  const montoARS = Number(g?.total ?? 0) * (Number((g as unknown as { tasa_cambio?: number })?.tasa_cambio) || 1);
                  return (
                    <label key={id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={retroSelected.has(id)}
                        onChange={e => {
                          const next = new Set(retroSelected);
                          if (e.target.checked) next.add(id); else next.delete(id);
                          setRetroSelected(next);
                        }}
                      />
                      <span className="text-sm font-medium w-24 shrink-0 tabular-nums">
                        {(g?.fecha as string) ?? `#${id}`}
                      </span>
                      <span className="text-sm text-[var(--muted)] flex-1 truncate">
                        {(g?.concepto as string) ?? "—"}
                      </span>
                      <span className="text-sm font-semibold text-right shrink-0">
                        {formatMoney(montoARS, base, country.locale)}
                      </span>
                    </label>
                  );
                })}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
              <button className="btn btn-secondary" onClick={() => setRetroSelectMode(false)}>
                Volver
              </button>
              <button
                className="btn btn-primary"
                disabled={retroSelected.size === 0}
                onClick={() => {
                  const ids = [...retroSelected];
                  saveConfig(pendingRetro.contactoId, pendingRetro.concepto, pendingRetro.cfg);
                  applyTemplateToPayments(pendingRetro.contactoId, pendingRetro.concepto, pendingRetro.cfg, ids);
                  resyncPagosParaConcepto(ids, pendingRetro.concepto, pendingRetro.cfg, pendingRetro.contactoId);
                  setSaveCount(c => c + 1);
                  closePendingRetro();
                }}
              >
                Aplicar a {retroSelected.size} pago{retroSelected.size !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
