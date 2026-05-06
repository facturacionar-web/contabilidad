"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import { useTable, paisFilter, restoreRow, purgeRow } from "@/lib/useSupabaseData";
import { useConfig } from "@/lib/useConfig";
import { formatMoney, formatDate } from "@/lib/format";
import type { CurrencyCode } from "@/lib/countries";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import {
  Trash2,
  Receipt,
  Users,
  Layers,
  Building2,
  CreditCard,
  TrendingUp,
  FileMinus,
  RotateCcw,
  Loader2,
  AlertTriangle,
} from "lucide-react";

type EntityKey = "gastos_factura" | "gastos_pago" | "ingresos" | "notas_credito" | "contactos" | "conceptos" | "cuentas";

const TABS: { key: EntityKey; label: string; icon: React.ComponentType<{ className?: string }>; table: "gastos" | "ingresos" | "notas_credito" | "contactos" | "conceptos" | "cuentas" }[] = [
  { key: "gastos_factura", label: "Facturas", icon: Receipt, table: "gastos" },
  { key: "gastos_pago", label: "Pagos", icon: CreditCard, table: "gastos" },
  { key: "ingresos", label: "Ingresos", icon: TrendingUp, table: "ingresos" },
  { key: "notas_credito", label: "Notas de crédito", icon: FileMinus, table: "notas_credito" },
  { key: "contactos", label: "Contactos", icon: Users, table: "contactos" },
  { key: "conceptos", label: "Conceptos", icon: Layers, table: "conceptos" },
  { key: "cuentas", label: "Cuentas", icon: Building2, table: "cuentas" },
];

export default function PapeleraPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const [activeTab, setActiveTab] = useState<EntityKey>("gastos_factura");
  const [busy, setBusy] = useState<string | null>(null);

  const tab = TABS.find(t => t.key === activeTab)!;

  // Para gastos hay que filtrar por tipo extra
  const isFacturas = activeTab === "gastos_factura";
  const isPagos = activeTab === "gastos_pago";
  const extraFilter = isFacturas
    ? [{ column: "tipo", op: "eq" as const, value: "factura_proveedor" }]
    : isPagos
    ? [{ column: "tipo", op: "eq" as const, value: "gasto" }]
    : [];

  const { data: gastosDel, reload: reloadGastos } = useTable("gastos", {
    orderBy: "deleted_at", ascending: false,
    filter: [...(paisFilter(pais) ?? []), ...extraFilter],
    skip: !pais || (activeTab !== "gastos_factura" && activeTab !== "gastos_pago"),
    deps: [pais, activeTab],
    softDeleteFilter: "deleted",
  });
  const { data: ingresosDel, reload: reloadIngresos } = useTable("ingresos", {
    orderBy: "deleted_at", ascending: false,
    filter: paisFilter(pais),
    skip: !pais || activeTab !== "ingresos",
    deps: [pais, activeTab],
    softDeleteFilter: "deleted",
  });
  const { data: notasDel, reload: reloadNotas } = useTable("notas_credito", {
    orderBy: "deleted_at", ascending: false,
    filter: paisFilter(pais),
    skip: !pais || activeTab !== "notas_credito",
    deps: [pais, activeTab],
    softDeleteFilter: "deleted",
  });
  const { data: contactosDel, reload: reloadContactos } = useTable("contactos", {
    orderBy: "deleted_at", ascending: false,
    filter: paisFilter(pais),
    skip: !pais || activeTab !== "contactos",
    deps: [pais, activeTab],
    softDeleteFilter: "deleted",
  });
  const { data: conceptosDel, reload: reloadConceptos } = useTable("conceptos", {
    orderBy: "deleted_at", ascending: false,
    filter: paisFilter(pais),
    skip: !pais || activeTab !== "conceptos",
    deps: [pais, activeTab],
    softDeleteFilter: "deleted",
  });
  const { data: cuentasDel, reload: reloadCuentas } = useTable("cuentas", {
    orderBy: "deleted_at", ascending: false,
    filter: paisFilter(pais),
    skip: !pais || activeTab !== "cuentas",
    deps: [pais, activeTab],
    softDeleteFilter: "deleted",
  });

  // Contadores para los tabs
  const counts = useMemo(() => ({
    gastos_factura: (gastosDel ?? []).filter(g => g.tipo === "factura_proveedor").length,
    gastos_pago: (gastosDel ?? []).filter(g => g.tipo === "gasto").length,
    ingresos: ingresosDel?.length ?? 0,
    notas_credito: notasDel?.length ?? 0,
    contactos: contactosDel?.length ?? 0,
    conceptos: conceptosDel?.length ?? 0,
    cuentas: cuentasDel?.length ?? 0,
  }), [gastosDel, ingresosDel, notasDel, contactosDel, conceptosDel, cuentasDel]);

  async function handleRestore(table: typeof tab.table, id: number | string) {
    const key = `${table}-${id}`;
    setBusy(key);
    try {
      await restoreRow(table, id);
      await reloadCurrent();
    } catch (e) {
      alert("Error al restaurar: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handlePurge(table: typeof tab.table, id: number | string, label: string) {
    if (!confirm(`Eliminar definitivamente "${label}"?\n\nEsta acción no se puede deshacer.`)) return;
    const key = `${table}-${id}-purge`;
    setBusy(key);
    try {
      await purgeRow(table, id);
      await reloadCurrent();
    } catch (e) {
      alert("Error al eliminar: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function reloadCurrent() {
    if (activeTab === "gastos_factura" || activeTab === "gastos_pago") await reloadGastos();
    else if (activeTab === "ingresos") await reloadIngresos();
    else if (activeTab === "notas_credito") await reloadNotas();
    else if (activeTab === "contactos") await reloadContactos();
    else if (activeTab === "conceptos") await reloadConceptos();
    else if (activeTab === "cuentas") await reloadCuentas();
  }

  return (
    <>
      <PageHeader
        title="Papelera"
        description="Registros eliminados — podés restaurarlos o eliminarlos definitivamente"
      />

      <div className="card p-0 overflow-hidden mb-6">
        <div className="flex items-center gap-1 px-2 py-2 border-b border-[var(--border)] overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon;
            const isActive = activeTab === t.key;
            const count = counts[t.key];
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-[var(--primary-soft)] text-[var(--primary-hover)]"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
                {count > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    isActive ? "bg-[var(--primary)] text-white" : "bg-slate-200 text-slate-600"
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Contenido del tab */}
        <div>
          {activeTab === "gastos_factura" && (
            <FacturasTable
              rows={(gastosDel ?? []).filter(g => g.tipo === "factura_proveedor")}
              onRestore={(id) => handleRestore("gastos", id)}
              onPurge={(id, label) => handlePurge("gastos", id, label)}
              busy={busy}
              base={(config?.moneda_base ?? "ARS") as CurrencyCode}
              locale={country.locale}
            />
          )}
          {activeTab === "gastos_pago" && (
            <PagosTable
              rows={(gastosDel ?? []).filter(g => g.tipo === "gasto")}
              onRestore={(id) => handleRestore("gastos", id)}
              onPurge={(id, label) => handlePurge("gastos", id, label)}
              busy={busy}
              locale={country.locale}
            />
          )}
          {activeTab === "ingresos" && (
            <SimpleTable
              title="Ingreso"
              rows={(ingresosDel ?? []).map(r => ({
                id: r.id,
                col1: r.concepto,
                col2: formatDate(r.fecha, country.locale),
                col3: formatMoney(Number(r.monto), r.moneda as CurrencyCode, country.locale),
                deleted_at: (r as unknown as { deleted_at?: string }).deleted_at,
                label: r.concepto,
              }))}
              onRestore={(id) => handleRestore("ingresos", id)}
              onPurge={(id, label) => handlePurge("ingresos", id, label)}
              busy={busy}
              tableKey="ingresos"
              cols={["Concepto", "Fecha", "Monto"]}
              locale={country.locale}
            />
          )}
          {activeTab === "notas_credito" && (
            <SimpleTable
              title="Nota de crédito"
              rows={(notasDel ?? []).map(r => ({
                id: r.id,
                col1: r.numero ?? `#${r.id}`,
                col2: r.concepto,
                col3: formatMoney(Number(r.monto), r.moneda as CurrencyCode, country.locale),
                deleted_at: (r as unknown as { deleted_at?: string }).deleted_at,
                label: `NC ${r.numero ?? r.id}`,
              }))}
              onRestore={(id) => handleRestore("notas_credito", id)}
              onPurge={(id, label) => handlePurge("notas_credito", id, label)}
              busy={busy}
              tableKey="notas_credito"
              cols={["Número", "Concepto", "Monto"]}
              locale={country.locale}
            />
          )}
          {activeTab === "contactos" && (
            <SimpleTable
              title="Contacto"
              rows={(contactosDel ?? []).map(r => ({
                id: r.id,
                col1: r.nombre,
                col2: r.tipo,
                col3: r.tax_id ?? "—",
                deleted_at: (r as unknown as { deleted_at?: string }).deleted_at,
                label: r.nombre,
              }))}
              onRestore={(id) => handleRestore("contactos", id)}
              onPurge={(id, label) => handlePurge("contactos", id, label)}
              busy={busy}
              tableKey="contactos"
              cols={["Nombre", "Tipo", "Identificación"]}
              locale={country.locale}
            />
          )}
          {activeTab === "conceptos" && (
            <SimpleTable
              title="Concepto"
              rows={(conceptosDel ?? []).map(r => ({
                id: r.id,
                col1: r.nombre,
                col2: r.tipo,
                col3: r.descripcion ?? "—",
                deleted_at: (r as unknown as { deleted_at?: string }).deleted_at,
                label: r.nombre,
              }))}
              onRestore={(id) => handleRestore("conceptos", id)}
              onPurge={(id, label) => handlePurge("conceptos", id, label)}
              busy={busy}
              tableKey="conceptos"
              cols={["Nombre", "Tipo", "Descripción"]}
              locale={country.locale}
            />
          )}
          {activeTab === "cuentas" && (
            <SimpleTable
              title="Cuenta"
              rows={(cuentasDel ?? []).map(r => ({
                id: r.id,
                col1: r.nombre,
                col2: r.tipo,
                col3: r.moneda,
                deleted_at: (r as unknown as { deleted_at?: string }).deleted_at,
                label: r.nombre,
              }))}
              onRestore={(id) => handleRestore("cuentas", id)}
              onPurge={(id, label) => handlePurge("cuentas", id, label)}
              busy={busy}
              tableKey="cuentas"
              cols={["Nombre", "Tipo", "Moneda"]}
              locale={country.locale}
            />
          )}
        </div>
      </div>

      <p className="text-xs text-[var(--muted)] flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
        Restaurar vuelve el registro a la lista activa. Eliminar definitivamente <strong>no se puede deshacer</strong>.
      </p>
    </>
  );
}

// ── Tablas ───────────────────────────────────────────────────────────────────

type ActionsProps = {
  busyKey: string | null;
  onRestore: () => void;
  onPurge: () => void;
  rowKey: string;
  purgeKey: string;
};

function Actions({ busyKey, onRestore, onPurge, rowKey, purgeKey }: ActionsProps) {
  return (
    <div className="flex items-center gap-1 justify-end">
      <button
        onClick={onRestore}
        disabled={busyKey === rowKey}
        className="btn btn-ghost p-1.5 text-emerald-600"
        title="Restaurar"
      >
        {busyKey === rowKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
      </button>
      <button
        onClick={onPurge}
        disabled={busyKey === purgeKey}
        className="btn btn-ghost p-1.5 text-red-600"
        title="Eliminar definitivamente"
      >
        {busyKey === purgeKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
      </button>
    </div>
  );
}

function FacturasTable({ rows, onRestore, onPurge, busy, base, locale }: {
  rows: import("@/lib/types").Gasto[];
  onRestore: (id: number) => void;
  onPurge: (id: number, label: string) => void;
  busy: string | null;
  base: CurrencyCode;
  locale: string;
}) {
  if (rows.length === 0) return <Empty />;
  return (
    <table className="table text-sm">
      <thead>
        <tr>
          <th>N° Factura</th>
          <th>Concepto</th>
          <th>Eliminada</th>
          <th className="text-right">Total</th>
          <th className="text-right">Acciones</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(g => {
          const label = `Factura ${g.numero_factura ?? `#${g.id}`}`;
          return (
            <tr key={g.id}>
              <td className="font-medium">{g.numero_factura || `#${g.id}`}</td>
              <td className="text-[var(--muted)] truncate max-w-xs">{g.concepto}</td>
              <td className="text-[var(--muted)] whitespace-nowrap text-xs">
                {(g as unknown as { deleted_at?: string }).deleted_at
                  ? formatDate((g as unknown as { deleted_at: string }).deleted_at, locale)
                  : "—"}
              </td>
              <td className="text-right font-semibold whitespace-nowrap">
                {formatMoney(Number(g.total), g.moneda, locale)}
              </td>
              <td className="text-right">
                <Actions
                  busyKey={busy}
                  onRestore={() => onRestore(g.id)}
                  onPurge={() => onPurge(g.id, label)}
                  rowKey={`gastos-${g.id}`}
                  purgeKey={`gastos-${g.id}-purge`}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function PagosTable({ rows, onRestore, onPurge, busy, locale }: {
  rows: import("@/lib/types").Gasto[];
  onRestore: (id: number) => void;
  onPurge: (id: number, label: string) => void;
  busy: string | null;
  locale: string;
}) {
  if (rows.length === 0) return <Empty />;
  return (
    <table className="table text-sm">
      <thead>
        <tr>
          <th>#</th>
          <th>Fecha</th>
          <th>Concepto</th>
          <th>Eliminado</th>
          <th className="text-right">Total</th>
          <th className="text-right">Acciones</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(g => (
          <tr key={g.id}>
            <td className="text-[var(--muted)]">#{g.id}</td>
            <td className="whitespace-nowrap">{formatDate(g.fecha, locale)}</td>
            <td className="text-[var(--muted)] truncate max-w-xs">{g.concepto}</td>
            <td className="text-[var(--muted)] whitespace-nowrap text-xs">
              {(g as unknown as { deleted_at?: string }).deleted_at
                ? formatDate((g as unknown as { deleted_at: string }).deleted_at, locale)
                : "—"}
            </td>
            <td className="text-right font-semibold whitespace-nowrap">
              {formatMoney(Number(g.total), g.moneda, locale)}
            </td>
            <td className="text-right">
              <Actions
                busyKey={busy}
                onRestore={() => onRestore(g.id)}
                onPurge={() => onPurge(g.id, `Pago #${g.id}`)}
                rowKey={`gastos-${g.id}`}
                purgeKey={`gastos-${g.id}-purge`}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SimpleTable<T extends { id: number | string; col1: string; col2: string; col3: string; deleted_at?: string; label: string }>({
  rows, cols, onRestore, onPurge, busy, tableKey, locale,
}: {
  title: string;
  rows: T[];
  cols: [string, string, string];
  onRestore: (id: number | string) => void;
  onPurge: (id: number | string, label: string) => void;
  busy: string | null;
  tableKey: string;
  locale: string;
}) {
  if (rows.length === 0) return <Empty />;
  return (
    <table className="table text-sm">
      <thead>
        <tr>
          <th>{cols[0]}</th>
          <th>{cols[1]}</th>
          <th>{cols[2]}</th>
          <th>Eliminado</th>
          <th className="text-right">Acciones</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={String(r.id)}>
            <td className="font-medium">{r.col1}</td>
            <td className="text-[var(--muted)]">{r.col2}</td>
            <td className="text-[var(--muted)] truncate max-w-xs">{r.col3}</td>
            <td className="text-[var(--muted)] whitespace-nowrap text-xs">
              {r.deleted_at ? formatDate(r.deleted_at, locale) : "—"}
            </td>
            <td className="text-right">
              <Actions
                busyKey={busy}
                onRestore={() => onRestore(r.id)}
                onPurge={() => onPurge(r.id, r.label)}
                rowKey={`${tableKey}-${r.id}`}
                purgeKey={`${tableKey}-${r.id}-purge`}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Empty() {
  return (
    <EmptyState
      icon={<Trash2 className="w-6 h-6" />}
      title="No hay registros eliminados"
      description="Cuando elimines algún registro va a aparecer acá. Podrás restaurarlo o eliminarlo definitivamente."
    />
  );
}
