"use client";
import { useState } from "react";
import { useTable, insertRow, updateRow, deleteRow, paisFilter } from "@/lib/useSupabaseData";
import type { Gasto, GastoEstado } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import { CURRENCIES, CurrencyCode, PAYMENT_METHODS, monedasDisponibles } from "@/lib/countries";
import { formatMoney, formatDate, todayISO } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { Plus, CreditCard, Pencil, Trash2, Search } from "lucide-react";

type FormState = {
  fecha: string;
  contacto_id: number | "";
  concepto: string;
  concepto_id: string;
  cuenta_id: string;
  monto: number;
  moneda: CurrencyCode;
  estado: GastoEstado;
  metodo_pago: string;
  notas: string;
};

function blank(moneda: CurrencyCode): FormState {
  return {
    fecha: todayISO(),
    contacto_id: "",
    concepto: "",
    concepto_id: "",
    cuenta_id: "",
    monto: 0,
    moneda,
    estado: "pagado",
    metodo_pago: PAYMENT_METHODS[0],
    notas: "",
  };
}

export default function PagosEgresosPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const monedas = pais ? monedasDisponibles(pais) : (["MXN"] as CurrencyCode[]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Gasto | null>(null);
  const [form, setForm] = useState<FormState>(blank("MXN"));
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: gastos, reload } = useTable("gastos", {
    orderBy: "fecha",
    filter: [
      ...(paisFilter(pais) ?? []),
      { column: "tipo", op: "eq", value: "gasto" },
    ],
    skip: !pais,
    deps: [pais],
  });
  const { data: contactos } = useTable("contactos", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });
  const { data: conceptosAll } = useTable("conceptos", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });
  const { data: cuentas } = useTable("cuentas", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });

  const conceptos = (conceptosAll ?? []).filter(
    (c) => c.tipo === "egreso" || c.tipo === "ambos"
  );
  const proveedores = (contactos ?? []).filter(
    (c) => c.tipo === "proveedor" || c.tipo === "ambos"
  );

  const filtered = (gastos ?? []).filter((g) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return g.concepto.toLowerCase().includes(q);
  });

  const totalPorMoneda = (gastos ?? []).reduce<Record<string, number>>(
    (acc, g) => {
      acc[g.moneda] = (acc[g.moneda] ?? 0) + Number(g.total);
      return acc;
    },
    {}
  );

  function openNew() {
    setEditing(null);
    setForm(blank(monedas[0]));
    setOpen(true);
  }

  function openEdit(g: Gasto) {
    setEditing(g);
    setForm({
      fecha: g.fecha,
      contacto_id: g.contacto_id ?? "",
      concepto: g.concepto,
      concepto_id: g.concepto_id ?? "",
      cuenta_id: g.cuenta_id ?? "",
      monto: Number(g.total),
      moneda: g.moneda,
      estado: g.estado,
      metodo_pago: g.metodo_pago ?? PAYMENT_METHODS[0],
      notas: g.notas ?? "",
    });
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.concepto.trim() || form.monto <= 0) return;
    setSaving(true);
    try {
      const payload = {
        ctx_pais: pais,
        fecha: form.fecha,
        tipo: "gasto" as const,
        contacto_id: form.contacto_id === "" ? null : Number(form.contacto_id),
        concepto: form.concepto,
        categoria: form.concepto_id
          ? (conceptos.find((c) => c.id === form.concepto_id)?.nombre ?? "")
          : "",
        concepto_id: form.concepto_id || null,
        cuenta_id: form.cuenta_id || null,
        subtotal: form.monto,
        iva: 0,
        iva_monto: 0,
        total: form.monto,
        moneda: form.moneda,
        estado: form.estado,
        metodo_pago: form.metodo_pago || null,
        monto_pagado: form.estado === "pagado" ? form.monto : 0,
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
    if (!confirm("¿Eliminar este pago?")) return;
    try {
      await deleteRow("gastos", g.id);
      await reload();
    } catch (err) {
      alert("Error: " + (err as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Pagos"
        description="Pagos y gastos directos sin IVA detallado"
        action={
          <button className="btn btn-primary" onClick={openNew}>
            <Plus className="w-4 h-4" /> Nuevo pago
          </button>
        }
      />

      {Object.keys(totalPorMoneda).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {Object.entries(totalPorMoneda).map(([cur, total]) => (
            <div key={cur} className="card py-3">
              <p className="text-xs text-[var(--muted)]">Total {cur}</p>
              <p className="text-lg font-semibold text-red-600">
                -{formatMoney(total, cur as CurrencyCode, country.locale)}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input pl-9 sm:w-72"
              placeholder="Buscar por descripción…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<CreditCard className="w-6 h-6" />}
            title={gastos?.length ? "Sin resultados" : "Aún no hay pagos"}
            description="Registrá pagos y gastos directos de tu empresa."
            action={
              !gastos?.length && (
                <button className="btn btn-primary" onClick={openNew}>
                  <Plus className="w-4 h-4" /> Nuevo pago
                </button>
              )
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Descripción</th>
                <th>Concepto</th>
                <th>Proveedor</th>
                <th>Método</th>
                <th className="text-right">Monto</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <tr key={g.id}>
                  <td className="whitespace-nowrap">{formatDate(g.fecha, country.locale)}</td>
                  <td className="font-medium max-w-xs truncate">{g.concepto}</td>
                  <td className="text-[var(--muted)]">
                    {conceptosAll?.find((c) => c.id === g.concepto_id)?.nombre ?? g.categoria ?? "—"}
                  </td>
                  <td className="text-[var(--muted)]">
                    {contactos?.find((c) => c.id === g.contacto_id)?.nombre ?? "—"}
                  </td>
                  <td className="text-[var(--muted)]">{g.metodo_pago ?? "—"}</td>
                  <td className="text-right font-semibold text-red-600 whitespace-nowrap">
                    -{formatMoney(Number(g.total), g.moneda, country.locale)}
                  </td>
                  <td className="text-right whitespace-nowrap">
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

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Editar pago" : "Nuevo pago"} size="lg">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Fecha *</label>
              <input type="date" className="input" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} required />
            </div>
            <div>
              <label className="label">Método de pago</label>
              <select className="select" value={form.metodo_pago} onChange={(e) => setForm({ ...form, metodo_pago: e.target.value })}>
                {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Descripción *</label>
              <input className="input" placeholder="¿En qué se gastó?" value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} required />
            </div>
            <div>
              <label className="label">Concepto</label>
              <select className="select" value={form.concepto_id} onChange={(e) => setForm({ ...form, concepto_id: e.target.value })}>
                <option value="">— Sin concepto —</option>
                {conceptos.length === 0 && <option disabled>No hay conceptos. Creá uno en Conceptos.</option>}
                {conceptos.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Proveedor</label>
              <select className="select" value={form.contacto_id} onChange={(e) => setForm({ ...form, contacto_id: e.target.value === "" ? "" : Number(e.target.value) })}>
                <option value="">— Sin proveedor —</option>
                {proveedores.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Cuenta</label>
              <select className="select" value={form.cuenta_id} onChange={(e) => setForm({ ...form, cuenta_id: e.target.value })}>
                <option value="">— Sin cuenta —</option>
                {(cuentas ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre} ({c.moneda})</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                {monedas.map((code) => (
                  <option key={code} value={code}>{code} — {CURRENCIES[code].name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Notas</label>
            <textarea className="textarea" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Guardando…" : editing ? "Guardar cambios" : "Registrar pago"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
