"use client";
import { useState } from "react";
import { useTable, insertRow, updateRow, deleteRow } from "@/lib/useSupabaseData";
import type { Ingreso, IngresoTipo } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import {
  CURRENCIES,
  CurrencyCode,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
} from "@/lib/countries";
import { formatMoney, formatDate, todayISO } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { Plus, TrendingUp, Pencil, Trash2, Search } from "lucide-react";

type FormState = {
  fecha: string;
  tipo: IngresoTipo;
  contacto_id: number | "";
  concepto: string;
  categoria: string;
  monto: number;
  moneda: CurrencyCode;
  metodo_pago: string;
  referencia: string;
  notas: string;
};

const BLANK: FormState = {
  fecha: todayISO(),
  tipo: "ingreso_dinero",
  contacto_id: "",
  concepto: "",
  categoria: INCOME_CATEGORIES[0],
  monto: 0,
  moneda: "MXN",
  metodo_pago: PAYMENT_METHODS[0],
  referencia: "",
  notas: "",
};

export default function IngresosPage() {
  const { config, country } = useConfig();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Ingreso | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"todos" | IngresoTipo>("todos");
  const [saving, setSaving] = useState(false);

  const { data: ingresos, reload } = useTable("ingresos", { orderBy: "fecha" });
  const { data: contactos } = useTable("contactos", { orderBy: "nombre", ascending: true });

  const filtered = (ingresos ?? []).filter((i) => {
    if (filter !== "todos" && i.tipo !== filter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return i.concepto.toLowerCase().includes(q) || i.categoria.toLowerCase().includes(q);
  });

  const contactoName = (id?: number | null) =>
    contactos?.find((c) => c.id === id)?.nombre ?? "—";

  function openNew() {
    setEditing(null);
    setForm({ ...BLANK, moneda: config?.moneda_base ?? "MXN", fecha: todayISO() });
    setOpen(true);
  }

  function openEdit(i: Ingreso) {
    setEditing(i);
    setForm({
      fecha: i.fecha,
      tipo: i.tipo,
      contacto_id: i.contacto_id ?? "",
      concepto: i.concepto,
      categoria: i.categoria,
      monto: Number(i.monto),
      moneda: i.moneda,
      metodo_pago: i.metodo_pago,
      referencia: i.referencia ?? "",
      notas: i.notas ?? "",
    });
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.concepto.trim() || form.monto <= 0) return;
    setSaving(true);
    try {
      const payload = {
        fecha: form.fecha,
        tipo: form.tipo,
        contacto_id: form.contacto_id === "" ? null : Number(form.contacto_id),
        concepto: form.concepto,
        categoria: form.categoria,
        monto: form.monto,
        moneda: form.moneda,
        metodo_pago: form.metodo_pago,
        referencia: form.referencia || null,
        notas: form.notas || null,
      };
      if (editing) {
        await updateRow("ingresos", editing.id, payload);
      } else {
        await insertRow("ingresos", payload);
      }
      await reload();
      setOpen(false);
    } catch (err) {
      alert("Error: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(i: Ingreso) {
    if (!confirm("¿Eliminar este ingreso?")) return;
    try {
      await deleteRow("ingresos", i.id);
      await reload();
    } catch (err) {
      alert("Error: " + (err as Error).message);
    }
  }

  const totalPorMoneda = (ingresos ?? []).reduce<Record<string, number>>(
    (acc, i) => {
      acc[i.moneda] = (acc[i.moneda] ?? 0) + Number(i.monto);
      return acc;
    },
    {}
  );

  return (
    <>
      <PageHeader
        title="Ingresos"
        description="Ingresos de dinero y otros ingresos"
        action={
          <button className="btn btn-primary" onClick={openNew}>
            <Plus className="w-4 h-4" /> Nuevo ingreso
          </button>
        }
      />

      {Object.keys(totalPorMoneda).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {Object.entries(totalPorMoneda).map(([cur, total]) => (
            <div key={cur} className="card py-3">
              <p className="text-xs text-[var(--muted)]">Total {cur}</p>
              <p className="text-lg font-semibold text-green-600">
                {formatMoney(total, cur as CurrencyCode, country.locale)}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="flex gap-1">
            {(["todos", "ingreso_dinero", "otro_ingreso"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filter === f
                    ? "bg-[var(--primary-soft)] text-[var(--primary-hover)]"
                    : "text-[var(--muted)] hover:bg-slate-100"
                }`}
              >
                {f === "todos" ? "Todos" : f === "ingreso_dinero" ? "Ingresos de dinero" : "Otros ingresos"}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input pl-9 sm:w-72"
              placeholder="Buscar por concepto o categoría"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<TrendingUp className="w-6 h-6" />}
            title={ingresos?.length ? "Sin resultados" : "Aún no hay ingresos"}
            description="Registra ingresos de dinero o cualquier otro ingreso distinto a una factura de venta."
            action={
              !ingresos?.length && (
                <button className="btn btn-primary" onClick={openNew}>
                  <Plus className="w-4 h-4" /> Nuevo ingreso
                </button>
              )
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th>Tipo</th>
                <th>Categoría</th>
                <th>Contacto</th>
                <th>Método</th>
                <th className="text-right">Monto</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id}>
                  <td className="whitespace-nowrap">{formatDate(i.fecha, country.locale)}</td>
                  <td className="font-medium max-w-xs truncate">{i.concepto}</td>
                  <td>
                    <span className={`badge ${i.tipo === "ingreso_dinero" ? "badge-success" : "badge-info"}`}>
                      {i.tipo === "ingreso_dinero" ? "Dinero" : "Otro"}
                    </span>
                  </td>
                  <td className="text-[var(--muted)]">{i.categoria}</td>
                  <td className="text-[var(--muted)]">{contactoName(i.contacto_id)}</td>
                  <td className="text-[var(--muted)]">{i.metodo_pago}</td>
                  <td className="text-right font-semibold text-green-600 whitespace-nowrap">
                    +{formatMoney(Number(i.monto), i.moneda, country.locale)}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn btn-ghost p-1.5" onClick={() => openEdit(i)}>
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button className="btn btn-ghost p-1.5 text-red-600" onClick={() => remove(i)}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Editar ingreso" : "Nuevo ingreso"} size="lg">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Fecha *</label>
              <input type="date" className="input" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} required />
            </div>
            <div>
              <label className="label">Tipo *</label>
              <select className="select" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as IngresoTipo })}>
                <option value="ingreso_dinero">Ingreso de dinero</option>
                <option value="otro_ingreso">Otro ingreso</option>
              </select>
            </div>
            <div>
              <label className="label">Categoría</label>
              <select className="select" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                {INCOME_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Concepto *</label>
            <input className="input" value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} required />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Monto *</label>
              <input
                type="number" step="0.01" min="0" className="input"
                value={form.monto || ""}
                onChange={(e) => setForm({ ...form, monto: parseFloat(e.target.value) || 0 })}
                required
              />
            </div>
            <div>
              <label className="label">Moneda *</label>
              <select className="select" value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value as CurrencyCode })}>
                {Object.values(CURRENCIES).map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))}
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Contacto</label>
              <select
                className="select"
                value={form.contacto_id}
                onChange={(e) => setForm({ ...form, contacto_id: e.target.value === "" ? "" : Number(e.target.value) })}
              >
                <option value="">— Sin contacto —</option>
                {contactos?.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Referencia</label>
              <input
                className="input"
                placeholder="N° de recibo, transferencia…"
                value={form.referencia}
                onChange={(e) => setForm({ ...form, referencia: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="label">Notas</label>
            <textarea className="textarea" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Guardando…" : editing ? "Guardar cambios" : "Registrar ingreso"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
