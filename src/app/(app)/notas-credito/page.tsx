"use client";
import { useState } from "react";
import { useTable, insertRow, updateRow, deleteRow } from "@/lib/useSupabaseData";
import type { NotaCredito, NotaCreditoTipo } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import { CURRENCIES, CurrencyCode } from "@/lib/countries";
import { formatMoney, formatDate, todayISO } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { Plus, FileMinus, Pencil, Trash2, Search } from "lucide-react";

type FormState = {
  fecha: string;
  tipo: NotaCreditoTipo;
  contacto_id: number | "";
  numero: string;
  gasto_relacionado_id: number | "";
  concepto: string;
  monto: number;
  moneda: CurrencyCode;
  motivo: string;
  notas: string;
};

const BLANK: FormState = {
  fecha: todayISO(),
  tipo: "recibida",
  contacto_id: "",
  numero: "",
  gasto_relacionado_id: "",
  concepto: "",
  monto: 0,
  moneda: "MXN",
  motivo: "",
  notas: "",
};

const MOTIVOS = [
  "Devolución de mercancía",
  "Descuento aplicado",
  "Error en facturación",
  "Anulación parcial",
  "Bonificación",
  "Otro",
];

export default function NotasCreditoPage() {
  const { config, country } = useConfig();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NotaCredito | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"todos" | NotaCreditoTipo>("todos");
  const [saving, setSaving] = useState(false);

  const { data: notas, reload } = useTable("notas_credito", { orderBy: "fecha" });
  const { data: contactos } = useTable("contactos", { orderBy: "nombre", ascending: true });
  const { data: gastos } = useTable("gastos", { orderBy: "fecha" });

  const filtered = (notas ?? []).filter((n) => {
    if (filter !== "todos" && n.tipo !== filter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      n.concepto.toLowerCase().includes(q) ||
      n.motivo.toLowerCase().includes(q) ||
      (n.numero?.toLowerCase() ?? "").includes(q)
    );
  });

  const contactoName = (id?: number | null) =>
    contactos?.find((c) => c.id === id)?.nombre ?? "—";

  function openNew() {
    setEditing(null);
    setForm({ ...BLANK, moneda: config?.moneda_base ?? "MXN", fecha: todayISO() });
    setOpen(true);
  }

  function openEdit(n: NotaCredito) {
    setEditing(n);
    setForm({
      fecha: n.fecha,
      tipo: n.tipo,
      contacto_id: n.contacto_id ?? "",
      numero: n.numero ?? "",
      gasto_relacionado_id: n.gasto_relacionado_id ?? "",
      concepto: n.concepto,
      monto: Number(n.monto),
      moneda: n.moneda,
      motivo: n.motivo,
      notas: n.notas ?? "",
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
        numero: form.numero || null,
        gasto_relacionado_id:
          form.gasto_relacionado_id === "" ? null : Number(form.gasto_relacionado_id),
        concepto: form.concepto,
        monto: form.monto,
        moneda: form.moneda,
        motivo: form.motivo,
        notas: form.notas || null,
      };
      if (editing) {
        await updateRow("notas_credito", editing.id, payload);
      } else {
        await insertRow("notas_credito", payload);
      }
      await reload();
      setOpen(false);
    } catch (err) {
      alert("Error: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(n: NotaCredito) {
    if (!confirm("¿Eliminar esta nota de crédito?")) return;
    try {
      await deleteRow("notas_credito", n.id);
      await reload();
    } catch (err) {
      alert("Error: " + (err as Error).message);
    }
  }

  const totalPorTipo = (notas ?? []).reduce<Record<string, Record<string, number>>>(
    (acc, n) => {
      acc[n.tipo] = acc[n.tipo] ?? {};
      acc[n.tipo][n.moneda] = (acc[n.tipo][n.moneda] ?? 0) + Number(n.monto);
      return acc;
    },
    {}
  );

  return (
    <>
      <PageHeader
        title="Notas de crédito"
        description="Notas emitidas a clientes y recibidas de proveedores"
        action={
          <button className="btn btn-primary" onClick={openNew}>
            <Plus className="w-4 h-4" /> Nueva nota
          </button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="card">
          <p className="text-sm text-[var(--muted)] mb-2">Emitidas (a clientes)</p>
          {Object.keys(totalPorTipo.emitida ?? {}).length === 0 ? (
            <p className="text-[var(--muted)] text-sm">Sin registros</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {Object.entries(totalPorTipo.emitida ?? {}).map(([cur, t]) => (
                <div key={cur}>
                  <p className="text-xs text-[var(--muted)]">{cur}</p>
                  <p className="text-lg font-semibold">
                    {formatMoney(t, cur as CurrencyCode, country.locale)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <p className="text-sm text-[var(--muted)] mb-2">Recibidas (de proveedores)</p>
          {Object.keys(totalPorTipo.recibida ?? {}).length === 0 ? (
            <p className="text-[var(--muted)] text-sm">Sin registros</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {Object.entries(totalPorTipo.recibida ?? {}).map(([cur, t]) => (
                <div key={cur}>
                  <p className="text-xs text-[var(--muted)]">{cur}</p>
                  <p className="text-lg font-semibold">
                    {formatMoney(t, cur as CurrencyCode, country.locale)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="flex gap-1">
            {(["todos", "emitida", "recibida"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filter === f
                    ? "bg-[var(--primary-soft)] text-[var(--primary-hover)]"
                    : "text-[var(--muted)] hover:bg-slate-100"
                }`}
              >
                {f === "todos" ? "Todas" : f === "emitida" ? "Emitidas" : "Recibidas"}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input pl-9 sm:w-72"
              placeholder="Buscar por concepto, motivo o número"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<FileMinus className="w-6 h-6" />}
            title={notas?.length ? "Sin resultados" : "Aún no hay notas de crédito"}
            description="Registra devoluciones, descuentos o anulaciones parciales."
            action={
              !notas?.length && (
                <button className="btn btn-primary" onClick={openNew}>
                  <Plus className="w-4 h-4" /> Nueva nota
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
                <th>Número</th>
                <th>Concepto</th>
                <th>Contacto</th>
                <th>Motivo</th>
                <th className="text-right">Monto</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((n) => (
                <tr key={n.id}>
                  <td className="whitespace-nowrap">{formatDate(n.fecha, country.locale)}</td>
                  <td>
                    <span className={`badge ${n.tipo === "emitida" ? "badge-info" : "badge-warning"}`}>
                      {n.tipo === "emitida" ? "Emitida" : "Recibida"}
                    </span>
                  </td>
                  <td className="text-[var(--muted)]">{n.numero || "—"}</td>
                  <td className="font-medium max-w-xs truncate">{n.concepto}</td>
                  <td className="text-[var(--muted)]">{contactoName(n.contacto_id)}</td>
                  <td className="text-[var(--muted)]">{n.motivo}</td>
                  <td className="text-right font-semibold whitespace-nowrap">
                    {formatMoney(Number(n.monto), n.moneda, country.locale)}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn btn-ghost p-1.5" onClick={() => openEdit(n)}>
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button className="btn btn-ghost p-1.5 text-red-600" onClick={() => remove(n)}>
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
        title={editing ? "Editar nota de crédito" : "Nueva nota de crédito"}
        size="lg"
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Fecha *</label>
              <input
                type="date"
                className="input"
                value={form.fecha}
                onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Tipo *</label>
              <select
                className="select"
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value as NotaCreditoTipo })}
              >
                <option value="recibida">Recibida (de proveedor)</option>
                <option value="emitida">Emitida (a cliente)</option>
              </select>
            </div>
            <div>
              <label className="label">Número</label>
              <input
                className="input"
                value={form.numero}
                onChange={(e) => setForm({ ...form, numero: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="label">Concepto *</label>
            <input
              className="input"
              value={form.concepto}
              onChange={(e) => setForm({ ...form, concepto: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Contacto</label>
              <select
                className="select"
                value={form.contacto_id}
                onChange={(e) =>
                  setForm({ ...form, contacto_id: e.target.value === "" ? "" : Number(e.target.value) })
                }
              >
                <option value="">— Sin contacto —</option>
                {contactos?.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Factura relacionada</label>
              <select
                className="select"
                value={form.gasto_relacionado_id}
                onChange={(e) =>
                  setForm({
                    ...form,
                    gasto_relacionado_id: e.target.value === "" ? "" : Number(e.target.value),
                  })
                }
              >
                <option value="">— Ninguna —</option>
                {gastos?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.numero_factura ? `#${g.numero_factura} — ` : ""}
                    {g.concepto} ({formatDate(g.fecha, country.locale)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Monto *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input"
                value={form.monto || ""}
                onChange={(e) => setForm({ ...form, monto: parseFloat(e.target.value) || 0 })}
                required
              />
            </div>
            <div>
              <label className="label">Moneda *</label>
              <select
                className="select"
                value={form.moneda}
                onChange={(e) => setForm({ ...form, moneda: e.target.value as CurrencyCode })}
              >
                {Object.values(CURRENCIES).map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Motivo *</label>
              <select
                className="select"
                value={form.motivo}
                onChange={(e) => setForm({ ...form, motivo: e.target.value })}
                required
              >
                <option value="">— Elegir —</option>
                {MOTIVOS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Notas</label>
            <textarea
              className="textarea"
              value={form.notas}
              onChange={(e) => setForm({ ...form, notas: e.target.value })}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear nota"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
