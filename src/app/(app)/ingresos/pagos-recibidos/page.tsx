"use client";
import { useState } from "react";
import { useTable, insertRow, updateRow, deleteRow, paisFilter } from "@/lib/useSupabaseData";
import type { Ingreso } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import { CURRENCIES, CurrencyCode, PAYMENT_METHODS, monedasDisponibles } from "@/lib/countries";
import { formatMoney, formatDate, todayISO } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { Plus, TrendingUp, Pencil, Trash2, Search } from "lucide-react";
import Link from "next/link";

type FormState = {
  fecha: string;
  contacto_id: number | "";
  concepto: string;
  concepto_id: string;
  cuenta_id: string;
  monto: number;
  moneda: CurrencyCode;
  metodo_pago: string;
  referencia: string;
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
    metodo_pago: PAYMENT_METHODS[0],
    referencia: "",
    notas: "",
  };
}

export default function PagosRecibidosPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const monedas = pais ? monedasDisponibles(pais) : (["MXN"] as CurrencyCode[]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Ingreso | null>(null);
  const [form, setForm] = useState<FormState>(blank("MXN"));
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: ingresos, reload } = useTable("ingresos", {
    orderBy: "fecha",
    filter: paisFilter(pais),
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
    (c) => c.tipo === "ingreso" || c.tipo === "ambos"
  );

  const filtered = (ingresos ?? []).filter((i) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return i.concepto.toLowerCase().includes(q);
  });

  const totalPorMoneda = (ingresos ?? []).reduce<Record<string, number>>(
    (acc, i) => {
      acc[i.moneda] = (acc[i.moneda] ?? 0) + Number(i.monto);
      return acc;
    },
    {}
  );

  function openNew() {
    setEditing(null);
    setForm(blank(monedas[0]));
    setOpen(true);
  }

  function openEdit(i: Ingreso) {
    setEditing(i);
    setForm({
      fecha: i.fecha,
      contacto_id: i.contacto_id ?? "",
      concepto: i.concepto,
      concepto_id: i.concepto_id ?? "",
      cuenta_id: i.cuenta_id ?? "",
      monto: Number(i.monto),
      moneda: i.moneda,
      metodo_pago: i.metodo_pago ?? PAYMENT_METHODS[0],
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
        ctx_pais: pais,
        fecha: form.fecha,
        tipo: "ingreso_dinero" as const,
        contacto_id: form.contacto_id === "" ? null : Number(form.contacto_id),
        concepto: form.concepto,
        categoria: form.concepto_id
          ? (conceptos.find((c) => c.id === form.concepto_id)?.nombre ?? "")
          : "",
        concepto_id: form.concepto_id || null,
        cuenta_id: form.cuenta_id || null,
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

  return (
    <>
      <PageHeader
        title="Pagos recibidos"
        description="Cobros y pagos recibidos de clientes"
        action={
          <button className="btn btn-primary" onClick={openNew}>
            <Plus className="w-4 h-4" /> Nuevo ingreso
          </button>
        }
      />

      {Object.keys(totalPorMoneda).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {Object.entries(totalPorMoneda).map(([cur, total]) => (
            <div key={cur} className="card py-3">
              <p className="text-xs text-[var(--muted)]">Total {cur}</p>
              <p className="text-lg font-semibold text-green-600">
                +{formatMoney(total, cur as CurrencyCode, country.locale)}
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
            icon={<TrendingUp className="w-6 h-6" />}
            title={ingresos?.length ? "Sin resultados" : "Aún no hay pagos recibidos"}
            description="Registrá los cobros recibidos de tus clientes."
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
                <th className="text-center w-10">#</th>
                <th>Fecha</th>
                <th>Descripción</th>
                <th>Concepto</th>
                <th>Cliente</th>
                <th>Cuenta</th>
                <th>Método</th>
                <th className="text-right">Monto</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id}>
                  <td className="text-center text-[var(--muted)] font-medium">{i.id}</td>
                  <td className="whitespace-nowrap">{formatDate(i.fecha, country.locale)}</td>
                  <td className="font-medium max-w-xs truncate">{i.concepto}</td>
                  <td className="text-[var(--muted)]">
                    {conceptosAll?.find((c) => c.id === i.concepto_id)?.nombre ?? i.categoria ?? "—"}
                  </td>
                  <td className="text-[var(--muted)]">
                    {i.contacto_id
                      ? <Link href={`/contactos/${i.contacto_id}`} className="hover:underline hover:text-[var(--primary)]">{contactos?.find(c => c.id === i.contacto_id)?.nombre ?? `#${i.contacto_id}`}</Link>
                      : "—"}
                  </td>
                  <td className="text-[var(--muted)]">
                    {cuentas?.find((c) => c.id === i.cuenta_id)?.nombre ?? "—"}
                  </td>
                  <td className="text-[var(--muted)]">{i.metodo_pago ?? "—"}</td>
                  <td className="text-right font-semibold text-green-600 whitespace-nowrap">
                    +{formatMoney(Number(i.monto), i.moneda, country.locale)}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {i.categoria === "devolución" ? (
                      <span className="text-xs text-[var(--muted)] px-2">Desde NC</span>
                    ) : (
                      <>
                        <button className="btn btn-ghost p-1.5" onClick={() => openEdit(i)}>
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button className="btn btn-ghost p-1.5 text-red-600" onClick={() => remove(i)}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Editar ingreso" : "Nuevo pago recibido"} size="lg">
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
              <input className="input" placeholder="Detalle del cobro…" value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} required />
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
              <label className="label">Cliente</label>
              <select className="select" value={form.contacto_id} onChange={(e) => setForm({ ...form, contacto_id: e.target.value === "" ? "" : Number(e.target.value) })}>
                <option value="">— Sin cliente —</option>
                {(contactos ?? [])
                  .filter((c) => c.tipo === "cliente" || c.tipo === "ambos")
                  .map((c) => (
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
            <label className="label">Referencia</label>
            <input
              className="input"
              placeholder="N° de recibo, transferencia…"
              value={form.referencia}
              onChange={(e) => setForm({ ...form, referencia: e.target.value })}
            />
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
