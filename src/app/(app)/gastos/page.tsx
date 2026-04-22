"use client";
import { useState, useMemo } from "react";
import { useTable, insertRow, updateRow, deleteRow } from "@/lib/useSupabaseData";
import type { Gasto, GastoTipo, GastoEstado } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import {
  CURRENCIES,
  CurrencyCode,
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
} from "@/lib/countries";
import { formatMoney, formatDate, todayISO } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { Plus, TrendingDown, Pencil, Trash2, Search, CheckCircle2 } from "lucide-react";

type FormState = {
  fecha: string;
  fecha_vencimiento: string;
  tipo: GastoTipo;
  contacto_id: number | "";
  numero_factura: string;
  concepto: string;
  categoria: string;
  subtotal: number;
  iva: number;
  moneda: CurrencyCode;
  estado: GastoEstado;
  metodo_pago: string;
  monto_pagado: number;
  notas: string;
};

function blank(moneda: CurrencyCode, ivaDefault: number): FormState {
  return {
    fecha: todayISO(),
    fecha_vencimiento: "",
    tipo: "gasto",
    contacto_id: "",
    numero_factura: "",
    concepto: "",
    categoria: EXPENSE_CATEGORIES[0],
    subtotal: 0,
    iva: ivaDefault,
    moneda,
    estado: "pagado",
    metodo_pago: PAYMENT_METHODS[0],
    monto_pagado: 0,
    notas: "",
  };
}

export default function GastosPage() {
  const { config, country } = useConfig();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Gasto | null>(null);
  const [form, setForm] = useState<FormState>(blank("MXN", 16));
  const [search, setSearch] = useState("");
  const [filterTipo, setFilterTipo] = useState<"todos" | GastoTipo>("todos");
  const [filterEstado, setFilterEstado] = useState<"todos" | GastoEstado>("todos");
  const [saving, setSaving] = useState(false);

  const { data: gastos, reload } = useTable("gastos", { orderBy: "fecha" });
  const { data: contactos } = useTable("contactos", { orderBy: "nombre", ascending: true });
  const proveedores = (contactos ?? []).filter(
    (c) => c.tipo === "proveedor" || c.tipo === "ambos"
  );

  const filtered = (gastos ?? []).filter((g) => {
    if (filterTipo !== "todos" && g.tipo !== filterTipo) return false;
    if (filterEstado !== "todos" && g.estado !== filterEstado) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      g.concepto.toLowerCase().includes(q) ||
      g.categoria.toLowerCase().includes(q) ||
      (g.numero_factura?.toLowerCase() ?? "").includes(q)
    );
  });

  const ivaMonto = useMemo(
    () => +(form.subtotal * (form.iva / 100)).toFixed(2),
    [form.subtotal, form.iva]
  );
  const total = useMemo(
    () => +(form.subtotal + ivaMonto).toFixed(2),
    [form.subtotal, ivaMonto]
  );

  const totalPorMoneda = (gastos ?? []).reduce<Record<string, number>>(
    (acc, g) => {
      acc[g.moneda] = (acc[g.moneda] ?? 0) + Number(g.total);
      return acc;
    },
    {}
  );

  function openNew(tipo: GastoTipo = "gasto") {
    setEditing(null);
    setForm({ ...blank(config?.moneda_base ?? "MXN", country.ivaDefault), tipo });
    setOpen(true);
  }

  function openEdit(g: Gasto) {
    setEditing(g);
    setForm({
      fecha: g.fecha,
      fecha_vencimiento: g.fecha_vencimiento ?? "",
      tipo: g.tipo,
      contacto_id: g.contacto_id ?? "",
      numero_factura: g.numero_factura ?? "",
      concepto: g.concepto,
      categoria: g.categoria,
      subtotal: Number(g.subtotal),
      iva: Number(g.iva),
      moneda: g.moneda,
      estado: g.estado,
      metodo_pago: g.metodo_pago ?? PAYMENT_METHODS[0],
      monto_pagado: Number(g.monto_pagado),
      notas: g.notas ?? "",
    });
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.concepto.trim() || form.subtotal <= 0) return;
    setSaving(true);
    try {
      const monto_pagado =
        form.estado === "pagado"
          ? total
          : form.estado === "pendiente"
          ? 0
          : form.monto_pagado;
      const payload = {
        fecha: form.fecha,
        fecha_vencimiento: form.fecha_vencimiento || null,
        tipo: form.tipo,
        contacto_id: form.contacto_id === "" ? null : Number(form.contacto_id),
        numero_factura: form.numero_factura || null,
        concepto: form.concepto,
        categoria: form.categoria,
        subtotal: form.subtotal,
        iva: form.iva,
        iva_monto: ivaMonto,
        total,
        moneda: form.moneda,
        estado: form.estado,
        metodo_pago: form.metodo_pago || null,
        monto_pagado,
        notas: form.notas || null,
      };
      if (editing) {
        await updateRow("gastos", editing.id, payload);
      } else {
        await insertRow("gastos", payload);
      }
      await reload();
      setOpen(false);
    } catch (err) {
      alert("Error: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(g: Gasto) {
    if (!confirm("¿Eliminar este registro?")) return;
    try {
      await deleteRow("gastos", g.id);
      await reload();
    } catch (err) {
      alert("Error: " + (err as Error).message);
    }
  }

  async function marcarPagado(g: Gasto) {
    try {
      await updateRow("gastos", g.id, { estado: "pagado", monto_pagado: Number(g.total) });
      await reload();
    } catch (err) {
      alert("Error: " + (err as Error).message);
    }
  }

  const estadoBadge = (e: GastoEstado) => {
    const map: Record<GastoEstado, string> = {
      pagado: "badge-success",
      pendiente: "badge-danger",
      parcial: "badge-warning",
    };
    const label: Record<GastoEstado, string> = {
      pagado: "Pagado",
      pendiente: "Pendiente",
      parcial: "Parcial",
    };
    return <span className={`badge ${map[e]}`}>{label[e]}</span>;
  };

  return (
    <>
      <PageHeader
        title="Gastos y Facturas de proveedor"
        description="Gastos generales y facturas recibidas de proveedores"
        action={
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={() => openNew("gasto")}>
              <Plus className="w-4 h-4" /> Gasto
            </button>
            <button className="btn btn-primary" onClick={() => openNew("factura_proveedor")}>
              <Plus className="w-4 h-4" /> Factura proveedor
            </button>
          </div>
        }
      />

      {Object.keys(totalPorMoneda).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {Object.entries(totalPorMoneda).map(([cur, total]) => (
            <div key={cur} className="card py-3">
              <p className="text-xs text-[var(--muted)]">Total {cur}</p>
              <p className="text-lg font-semibold text-red-600">
                {formatMoney(total, cur as CurrencyCode, country.locale)}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-3">
            <div className="flex gap-1">
              {(["todos", "gasto", "factura_proveedor"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilterTipo(f)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    filterTipo === f
                      ? "bg-[var(--primary-soft)] text-[var(--primary-hover)]"
                      : "text-[var(--muted)] hover:bg-slate-100"
                  }`}
                >
                  {f === "todos" ? "Todos" : f === "gasto" ? "Gastos" : "Facturas"}
                </button>
              ))}
            </div>
            <select
              className="select w-auto"
              value={filterEstado}
              onChange={(e) => setFilterEstado(e.target.value as "todos" | GastoEstado)}
            >
              <option value="todos">Todos los estados</option>
              <option value="pagado">Pagado</option>
              <option value="pendiente">Pendiente</option>
              <option value="parcial">Parcial</option>
            </select>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input pl-9 lg:w-72"
              placeholder="Buscar por concepto, factura…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<TrendingDown className="w-6 h-6" />}
            title={gastos?.length ? "Sin resultados" : "Aún no hay gastos"}
            description="Registra gastos del día a día o facturas recibidas de proveedores."
            action={
              !gastos?.length && (
                <button className="btn btn-primary" onClick={() => openNew()}>
                  <Plus className="w-4 h-4" /> Nuevo registro
                </button>
              )
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Concepto</th>
                <th>N° Factura</th>
                <th>Proveedor</th>
                <th>Estado</th>
                <th className="text-right">Total</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <tr key={g.id}>
                  <td className="whitespace-nowrap">{formatDate(g.fecha, country.locale)}</td>
                  <td>
                    <span className={`badge ${g.tipo === "factura_proveedor" ? "badge-info" : "badge-neutral"}`}>
                      {g.tipo === "factura_proveedor" ? "Factura" : "Gasto"}
                    </span>
                  </td>
                  <td className="font-medium max-w-xs truncate">{g.concepto}</td>
                  <td className="text-[var(--muted)]">{g.numero_factura || "—"}</td>
                  <td className="text-[var(--muted)]">
                    {contactos?.find((c) => c.id === g.contacto_id)?.nombre ?? "—"}
                  </td>
                  <td>{estadoBadge(g.estado)}</td>
                  <td className="text-right font-semibold text-red-600 whitespace-nowrap">
                    -{formatMoney(Number(g.total), g.moneda, country.locale)}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {g.estado !== "pagado" && (
                      <button className="btn btn-ghost p-1.5 text-green-600" onClick={() => marcarPagado(g)} title="Marcar como pagado">
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                    )}
                    <button className="btn btn-ghost p-1.5" onClick={() => openEdit(g)}>
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button className="btn btn-ghost p-1.5 text-red-600" onClick={() => remove(g)}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={
          editing
            ? form.tipo === "factura_proveedor" ? "Editar factura de proveedor" : "Editar gasto"
            : form.tipo === "factura_proveedor" ? "Nueva factura de proveedor" : "Nuevo gasto"
        }
        size="lg"
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Fecha *</label>
              <input type="date" className="input" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} required />
            </div>
            <div>
              <label className="label">Tipo</label>
              <select className="select" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as GastoTipo })}>
                <option value="gasto">Gasto</option>
                <option value="factura_proveedor">Factura de proveedor</option>
              </select>
            </div>
            <div>
              <label className="label">Categoría</label>
              <select className="select" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Concepto *</label>
              <input className="input" value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} required />
            </div>
            <div>
              <label className="label">Proveedor</label>
              <select
                className="select"
                value={form.contacto_id}
                onChange={(e) => setForm({ ...form, contacto_id: e.target.value === "" ? "" : Number(e.target.value) })}
              >
                <option value="">— Sin proveedor —</option>
                {proveedores.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>
          </div>

          {form.tipo === "factura_proveedor" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">N° de factura</label>
                <input className="input" value={form.numero_factura} onChange={(e) => setForm({ ...form, numero_factura: e.target.value })} />
              </div>
              <div>
                <label className="label">Vencimiento</label>
                <input type="date" className="input" value={form.fecha_vencimiento} onChange={(e) => setForm({ ...form, fecha_vencimiento: e.target.value })} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="label">Subtotal *</label>
              <input
                type="number" step="0.01" min="0" className="input"
                value={form.subtotal || ""}
                onChange={(e) => setForm({ ...form, subtotal: parseFloat(e.target.value) || 0 })}
                required
              />
            </div>
            <div>
              <label className="label">IVA %</label>
              <select className="select" value={form.iva} onChange={(e) => setForm({ ...form, iva: parseFloat(e.target.value) })}>
                {country.ivaRates.map((r) => (
                  <option key={r} value={r}>{r}%</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">IVA monto</label>
              <input className="input bg-slate-50" value={ivaMonto.toFixed(2)} readOnly />
            </div>
            <div>
              <label className="label">Total</label>
              <input className="input bg-slate-50 font-semibold" value={total.toFixed(2)} readOnly />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Moneda *</label>
              <select className="select" value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value as CurrencyCode })}>
                {Object.values(CURRENCIES).map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Estado *</label>
              <select className="select" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value as GastoEstado })}>
                <option value="pagado">Pagado</option>
                <option value="pendiente">Pendiente</option>
                <option value="parcial">Parcial</option>
              </select>
            </div>
            <div>
              <label className="label">Método de pago</label>
              <select className="select" value={form.metodo_pago} onChange={(e) => setForm({ ...form, metodo_pago: e.target.value })}>
                {PAYMENT_METHODS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          {form.estado === "parcial" && (
            <div>
              <label className="label">Monto pagado</label>
              <input
                type="number" step="0.01" min="0" max={total} className="input"
                value={form.monto_pagado || ""}
                onChange={(e) => setForm({ ...form, monto_pagado: parseFloat(e.target.value) || 0 })}
              />
            </div>
          )}

          <div>
            <label className="label">Notas</label>
            <textarea className="textarea" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Guardando…" : editing ? "Guardar cambios" : "Registrar"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
