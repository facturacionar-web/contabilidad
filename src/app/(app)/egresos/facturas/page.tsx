"use client";
import { useState, useMemo } from "react";
import { useTable, insertRow, updateRow, deleteRow, paisFilter } from "@/lib/useSupabaseData";
import type { Gasto, GastoEstado } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import { CURRENCIES, CurrencyCode, PAYMENT_METHODS, monedasDisponibles } from "@/lib/countries";
import { formatMoney, formatDate, todayISO } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { Plus, Receipt, Pencil, Trash2, Search, CheckCircle2 } from "lucide-react";

type FormState = {
  fecha: string;
  fecha_vencimiento: string;
  contacto_id: number | "";
  numero_factura: string;
  concepto: string;        // descripción libre
  concepto_id: string;     // FK a conceptos
  cuenta_id: string;       // FK a cuentas
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
    contacto_id: "",
    numero_factura: "",
    concepto: "",
    concepto_id: "",
    cuenta_id: "",
    subtotal: 0,
    iva: ivaDefault,
    moneda,
    estado: "pendiente",
    metodo_pago: PAYMENT_METHODS[0],
    monto_pagado: 0,
    notas: "",
  };
}

export default function FacturasPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const monedas = pais ? monedasDisponibles(pais) : (["MXN"] as CurrencyCode[]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Gasto | null>(null);
  const [form, setForm] = useState<FormState>(blank("MXN", 21));
  const [search, setSearch] = useState("");
  const [filterEstado, setFilterEstado] = useState<"todos" | GastoEstado>("todos");
  const [saving, setSaving] = useState(false);

  const { data: gastos, reload } = useTable("gastos", {
    orderBy: "fecha",
    filter: [
      ...(paisFilter(pais) ?? []),
      { column: "tipo", op: "eq", value: "factura_proveedor" },
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
    if (filterEstado !== "todos" && g.estado !== filterEstado) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      g.concepto.toLowerCase().includes(q) ||
      (g.numero_factura?.toLowerCase() ?? "").includes(q)
    );
  });

  const ivaMonto = useMemo(
    () => +(form.subtotal * (form.iva / 100)).toFixed(2),
    [form.subtotal, form.iva]
  );
  const total = useMemo(() => +(form.subtotal + ivaMonto).toFixed(2), [form.subtotal, ivaMonto]);

  const totalPorMoneda = (gastos ?? []).reduce<Record<string, { total: number; pendiente: number }>>(
    (acc, g) => {
      if (!acc[g.moneda]) acc[g.moneda] = { total: 0, pendiente: 0 };
      acc[g.moneda].total += Number(g.total);
      if (g.estado !== "pagado") acc[g.moneda].pendiente += Number(g.total) - Number(g.monto_pagado);
      return acc;
    },
    {}
  );

  function openNew() {
    setEditing(null);
    setForm(blank(monedas[0], country.ivaDefault));
    setOpen(true);
  }

  function openEdit(g: Gasto) {
    setEditing(g);
    setForm({
      fecha: g.fecha,
      fecha_vencimiento: g.fecha_vencimiento ?? "",
      contacto_id: g.contacto_id ?? "",
      numero_factura: g.numero_factura ?? "",
      concepto: g.concepto,
      concepto_id: g.concepto_id ?? "",
      cuenta_id: g.cuenta_id ?? "",
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
        form.estado === "pagado" ? total : form.estado === "pendiente" ? 0 : form.monto_pagado;
      const payload = {
        ctx_pais: pais,
        fecha: form.fecha,
        fecha_vencimiento: form.fecha_vencimiento || null,
        tipo: "factura_proveedor" as const,
        contacto_id: form.contacto_id === "" ? null : Number(form.contacto_id),
        numero_factura: form.numero_factura || null,
        concepto: form.concepto,
        categoria: form.concepto_id
          ? (conceptos.find((c) => c.id === form.concepto_id)?.nombre ?? "")
          : "",
        concepto_id: form.concepto_id || null,
        cuenta_id: form.cuenta_id || null,
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
    if (!confirm("¿Eliminar esta factura?")) return;
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
    const map: Record<GastoEstado, string> = { pagado: "badge-success", pendiente: "badge-danger", parcial: "badge-warning" };
    const label: Record<GastoEstado, string> = { pagado: "Pagado", pendiente: "Pendiente", parcial: "Parcial" };
    return <span className={`badge ${map[e]}`}>{label[e]}</span>;
  };

  return (
    <>
      <PageHeader
        title="Facturas de proveedor"
        description="Facturas recibidas de proveedores y sus estados de pago"
        action={
          <button className="btn btn-primary" onClick={openNew}>
            <Plus className="w-4 h-4" /> Nueva factura
          </button>
        }
      />

      {Object.keys(totalPorMoneda).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {Object.entries(totalPorMoneda).map(([cur, { total: t, pendiente: p }]) => (
            <div key={cur} className="card py-3">
              <p className="text-xs text-[var(--muted)]">Total {cur}</p>
              <p className="text-lg font-semibold text-red-600">
                {formatMoney(t, cur as CurrencyCode, country.locale)}
              </p>
              {p > 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  Por pagar: {formatMoney(p, cur as CurrencyCode, country.locale)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="flex gap-2 items-center">
            <select
              className="select w-auto"
              value={filterEstado}
              onChange={(e) => setFilterEstado(e.target.value as "todos" | GastoEstado)}
            >
              <option value="todos">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="parcial">Parcial</option>
              <option value="pagado">Pagado</option>
            </select>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input pl-9 sm:w-72"
              placeholder="Buscar por descripción o N° factura…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<Receipt className="w-6 h-6" />}
            title={gastos?.length ? "Sin resultados" : "Aún no hay facturas"}
            description="Registrá las facturas recibidas de tus proveedores."
            action={
              !gastos?.length && (
                <button className="btn btn-primary" onClick={openNew}>
                  <Plus className="w-4 h-4" /> Nueva factura
                </button>
              )
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>N° Factura</th>
                <th>Descripción</th>
                <th>Concepto</th>
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
                  <td className="text-[var(--muted)]">{g.numero_factura || "—"}</td>
                  <td className="font-medium max-w-xs truncate">{g.concepto}</td>
                  <td className="text-[var(--muted)]">
                    {conceptosAll?.find((c) => c.id === g.concepto_id)?.nombre ?? g.categoria ?? "—"}
                  </td>
                  <td className="text-[var(--muted)]">
                    {contactos?.find((c) => c.id === g.contacto_id)?.nombre ?? "—"}
                  </td>
                  <td>{estadoBadge(g.estado)}</td>
                  <td className="text-right font-semibold text-red-600 whitespace-nowrap">
                    -{formatMoney(Number(g.total), g.moneda, country.locale)}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {g.estado !== "pagado" && (
                      <button className="btn btn-ghost p-1.5 text-green-600" onClick={() => marcarPagado(g)} title="Marcar pagado">
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

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Editar factura" : "Nueva factura de proveedor"} size="lg">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Fecha *</label>
              <input type="date" className="input" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} required />
            </div>
            <div>
              <label className="label">N° de factura</label>
              <input className="input" placeholder="0001-00012345" value={form.numero_factura} onChange={(e) => setForm({ ...form, numero_factura: e.target.value })} />
            </div>
            <div>
              <label className="label">Vencimiento</label>
              <input type="date" className="input" value={form.fecha_vencimiento} onChange={(e) => setForm({ ...form, fecha_vencimiento: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Descripción *</label>
              <input className="input" placeholder="Detalle de la factura…" value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} required />
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

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="label">Subtotal *</label>
              <input type="number" step="0.01" min="0" className="input" value={form.subtotal || ""} onChange={(e) => setForm({ ...form, subtotal: parseFloat(e.target.value) || 0 })} required />
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
                {monedas.map((code) => (
                  <option key={code} value={code}>{code} — {CURRENCIES[code].name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Estado *</label>
              <select className="select" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value as GastoEstado })}>
                <option value="pendiente">Pendiente</option>
                <option value="parcial">Parcial</option>
                <option value="pagado">Pagado</option>
              </select>
            </div>
            <div>
              <label className="label">Método de pago</label>
              <select className="select" value={form.metodo_pago} onChange={(e) => setForm({ ...form, metodo_pago: e.target.value })}>
                {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          {form.estado === "parcial" && (
            <div>
              <label className="label">Monto pagado</label>
              <input type="number" step="0.01" min="0" max={total} className="input" value={form.monto_pagado || ""} onChange={(e) => setForm({ ...form, monto_pagado: parseFloat(e.target.value) || 0 })} />
            </div>
          )}

          <div>
            <label className="label">Notas</label>
            <textarea className="textarea" value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Guardando…" : editing ? "Guardar cambios" : "Registrar factura"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
