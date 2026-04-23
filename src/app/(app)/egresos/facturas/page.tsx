"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTable, insertRow, updateRow, deleteRow, paisFilter } from "@/lib/useSupabaseData";
import type { Gasto, GastoEstado, FacturaItem } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import { CURRENCIES, CurrencyCode, monedasDisponibles } from "@/lib/countries";
import { formatMoney, formatDate, todayISO } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import Link from "next/link";
import { Plus, Receipt, Pencil, Trash2, Search, CreditCard, X } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────
type LineItem = {
  key: string;
  concepto_id: string;
  precio: number;
  impuesto: number;
  cantidad: number;
  observaciones: string;
};

type FormState = {
  fecha: string;
  fecha_vencimiento: string;
  contacto_id: number | "";
  numero_factura: string;
  moneda: CurrencyCode;
  tasa_cambio: number;
  notas: string;
  items: LineItem[];
};

let _keyCounter = 0;
const nextKey = () => String(++_keyCounter);

function blankItem(): LineItem {
  return { key: nextKey(), concepto_id: "", precio: 0, impuesto: 0, cantidad: 1, observaciones: "" };
}

function blank(moneda: CurrencyCode): FormState {
  return { fecha: todayISO(), fecha_vencimiento: "", contacto_id: "", numero_factura: "", moneda, tasa_cambio: 1, notas: "", items: [blankItem()] };
}

function gastoToForm(g: Gasto): FormState {
  const raw = (g as unknown as { items?: FacturaItem[] }).items;
  const items: LineItem[] = raw?.length
    ? raw.map((it, i) => ({
        key: String(i),
        concepto_id: it.concepto_id ?? "",
        precio: Number(it.precio),
        impuesto: Number(it.impuesto),
        cantidad: Number(it.cantidad),
        observaciones: it.observaciones ?? "",
      }))
    : [{ key: "0", concepto_id: g.concepto_id ?? "", precio: Number(g.subtotal), impuesto: Number(g.iva), cantidad: 1, observaciones: "" }];
  return {
    fecha: g.fecha,
    fecha_vencimiento: g.fecha_vencimiento ?? "",
    contacto_id: g.contacto_id ?? "",
    numero_factura: g.numero_factura ?? "",
    moneda: g.moneda,
    tasa_cambio: (g as unknown as { tasa_cambio?: number }).tasa_cambio ?? 1,
    notas: g.notas ?? "",
    items,
  };
}

function itemNeto(it: LineItem) { return it.precio * it.cantidad; }
function itemIva(it: LineItem) { return itemNeto(it) * (it.impuesto / 100); }
function itemTotal(it: LineItem) { return itemNeto(it) + itemIva(it); }

// ── Component ──────────────────────────────────────────────────────────────
export default function FacturasPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const base = (config?.moneda_base ?? "ARS") as CurrencyCode;
  const monedas = pais ? monedasDisponibles(pais) : (["ARS"] as CurrencyCode[]);
  const searchParams = useSearchParams();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Gasto | null>(null);
  const [form, setForm] = useState<FormState>(blank(monedas[0] ?? "ARS"));
  const [search, setSearch] = useState("");
  const [filterEstado, setFilterEstado] = useState<"todos" | GastoEstado>("todos");
  const [saving, setSaving] = useState(false);
  const autoOpenedRef = useRef(false);

  const { data: gastos, reload } = useTable("gastos", {
    orderBy: "fecha",
    filter: [...(paisFilter(pais) ?? []), { column: "tipo", op: "eq", value: "factura_proveedor" }],
    skip: !pais, deps: [pais],
  });
  const { data: pagosData } = useTable("gastos", {
    orderBy: "fecha",
    filter: [...(paisFilter(pais) ?? []), { column: "tipo", op: "eq", value: "gasto" }],
    skip: !pais, deps: [pais],
  });
  const { data: notasData } = useTable("notas_credito", {
    orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais],
  });
  const { data: contactos } = useTable("contactos", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });
  const { data: conceptosAll } = useTable("conceptos", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });

  const conceptos = (conceptosAll ?? []).filter(c => c.tipo === "egreso" || c.tipo === "ambos");
  const proveedores = (contactos ?? []).filter(c => c.tipo === "proveedor" || c.tipo === "ambos");

  const filtered = (gastos ?? []).filter(g => {
    if (filterEstado !== "todos" && g.estado !== filterEstado) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return g.concepto.toLowerCase().includes(q) || (g.numero_factura?.toLowerCase() ?? "").includes(q);
  });

  const totals = useMemo(() => {
    const subtotal = form.items.reduce((s, it) => s + itemNeto(it), 0);
    const iva_monto = form.items.reduce((s, it) => s + itemIva(it), 0);
    const total = subtotal + iva_monto;
    const total_base = total * (form.tasa_cambio || 1);
    return { subtotal, iva_monto, total, total_base };
  }, [form.items, form.tasa_cambio]);

  const cashPaidByFactura = useMemo(() => {
    const map: Record<number, number> = {};
    for (const pago of (pagosData ?? [])) {
      for (const fp of (pago.factura_pagos ?? [])) {
        map[fp.factura_id] = Math.round(((map[fp.factura_id] ?? 0) + Number(fp.monto)) * 100) / 100;
      }
    }
    return map;
  }, [pagosData]);

  const creditByFactura = useMemo(() => {
    const map: Record<number, number> = {};
    for (const nota of (notasData ?? []).filter(n => n.tipo === "recibida")) {
      if (nota.gasto_relacionado_id) {
        map[nota.gasto_relacionado_id] = Math.round(((map[nota.gasto_relacionado_id] ?? 0) + Number(nota.monto)) * 100) / 100;
      }
    }
    return map;
  }, [notasData]);

  const totalPorMoneda = (gastos ?? []).reduce<Record<string, { total: number; pendiente: number }>>((acc, g) => {
    if (!acc[g.moneda]) acc[g.moneda] = { total: 0, pendiente: 0 };
    acc[g.moneda].total += Number(g.total);
    if (g.estado !== "pagado") acc[g.moneda].pendiente += Number(g.total) - Number(g.monto_pagado);
    return acc;
  }, {});

  const isForeignCurrency = form.moneda !== base;

  function openNew(proveedorId?: number) {
    setEditing(null);
    const f = blank(monedas[0] ?? base);
    if (proveedorId) f.contacto_id = proveedorId;
    setForm(f);
    setOpen(true);
  }

  useEffect(() => {
    if (autoOpenedRef.current || !pais || searchParams.get("nuevo") !== "1") return;
    const proveedorParam = searchParams.get("proveedor");
    autoOpenedRef.current = true;
    openNew(proveedorParam ? Number(proveedorParam) : undefined);
    const p = new URLSearchParams(searchParams.toString());
    p.delete("nuevo"); p.delete("proveedor");
    const qs = p.toString();
    router.replace(qs ? `/egresos/facturas?${qs}` : "/egresos/facturas");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pais, searchParams]);

  function openEdit(g: Gasto) { setEditing(g); setForm(gastoToForm(g)); setOpen(true); }
  function addItem() { setForm(f => ({ ...f, items: [...f.items, blankItem()] })); }
  function removeItem(key: string) { setForm(f => ({ ...f, items: f.items.filter(i => i.key !== key) })); }
  function updateItem(key: string, patch: Partial<Omit<LineItem, "key">>) {
    setForm(f => ({ ...f, items: f.items.map(i => i.key === key ? { ...i, ...patch } : i) }));
  }

  async function handleSave(mode: "save" | "new" | "pay") {
    if (!form.numero_factura.trim()) { alert("El número de factura es obligatorio."); return; }
    if (form.contacto_id === "") { alert("El proveedor es obligatorio."); return; }
    if (!form.fecha_vencimiento) { alert("La fecha de vencimiento es obligatoria."); return; }
    if (form.fecha_vencimiento < form.fecha) { alert("La fecha de vencimiento no puede ser anterior a la fecha de creación."); return; }
    if (form.items.some(it => !it.concepto_id || it.precio <= 0)) {
      alert("Todos los ítems deben tener concepto y precio.");
      return;
    }
    const duplicada = (gastos ?? []).find(g =>
      g.tipo === "factura_proveedor" &&
      g.contacto_id === Number(form.contacto_id) &&
      g.numero_factura === form.numero_factura &&
      g.id !== editing?.id
    );
    if (duplicada) {
      alert(`Ya existe una factura N° ${form.numero_factura} para este proveedor.`);
      return;
    }
    setSaving(true);
    try {
      const { subtotal, iva_monto, total } = totals;
      const firstItem = form.items[0];
      const firstConcept = conceptos.find(c => c.id === firstItem?.concepto_id);
      const concepto = firstConcept?.nombre || "Factura de proveedor";

      const itemsData: FacturaItem[] = form.items.map(it => ({
        concepto_id: it.concepto_id || null,
        concepto_nombre: conceptos.find(c => c.id === it.concepto_id)?.nombre ?? "",
        precio: it.precio,
        descuento: 0,
        impuesto: it.impuesto,
        cantidad: it.cantidad,
        observaciones: it.observaciones,
        neto: itemNeto(it),
        iva_monto: itemIva(it),
        total: itemTotal(it),
      }));

      const payload = {
        ctx_pais: pais,
        fecha: form.fecha,
        fecha_vencimiento: form.fecha_vencimiento || null,
        tipo: "factura_proveedor" as const,
        contacto_id: form.contacto_id === "" ? null : Number(form.contacto_id),
        numero_factura: form.numero_factura || null,
        concepto,
        categoria: firstConcept?.nombre ?? "",
        concepto_id: firstItem?.concepto_id || null,
        cuenta_id: null,
        subtotal,
        iva: firstItem?.impuesto ?? 0,
        iva_monto,
        total,
        moneda: form.moneda,
        tasa_cambio: form.tasa_cambio,
        estado: "pendiente" as GastoEstado,
        metodo_pago: null,
        monto_pagado: 0,
        notas: form.notas || null,
        items: itemsData,
      };

      let facturaId: number;
      if (editing) {
        await updateRow("gastos", editing.id, payload);
        facturaId = editing.id;
      } else {
        const inserted = await insertRow("gastos", payload);
        facturaId = inserted.id;
      }
      await reload();

      if (mode === "new") {
        setEditing(null);
        setForm(blank(form.moneda));
      } else if (mode === "pay") {
        setOpen(false);
        const qs = form.contacto_id !== ""
          ? `?nuevo=1&proveedor=${form.contacto_id}&factura=${facturaId}`
          : `?nuevo=1&factura=${facturaId}`;
        router.push(`/egresos/pagos${qs}`);
      } else {
        setOpen(false);
      }
    } catch (err) {
      alert("Error: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(g: Gasto) {
    if (!confirm("¿Eliminar esta factura?")) return;
    try { await deleteRow("gastos", g.id); await reload(); }
    catch (err) { alert("Error: " + (err as Error).message); }
  }

  const estadoBadge = (e: GastoEstado) => {
    const map: Record<GastoEstado, string> = { pagado: "badge-success", pendiente: "badge-danger", parcial: "badge-warning" };
    const label: Record<GastoEstado, string> = { pagado: "Pagado", pendiente: "Pendiente", parcial: "Parcial" };
    return <span className={`badge ${map[e]}`}>{label[e]}</span>;
  };

  const selectedProveedor = proveedores.find(c => c.id === (form.contacto_id !== "" ? Number(form.contacto_id) : -1));

  return (
    <>
      <PageHeader
        title="Facturas de proveedor"
        description="Facturas recibidas de proveedores y sus estados de pago"
        action={<button className="btn btn-primary" onClick={() => openNew()}><Plus className="w-4 h-4" /> Nueva factura</button>}
      />

      {Object.keys(totalPorMoneda).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {Object.entries(totalPorMoneda).map(([cur, { total: t, pendiente: p }]) => (
            <div key={cur} className="card py-3">
              <p className="text-xs text-[var(--muted)]">Total {cur}</p>
              <p className="text-lg font-semibold text-red-600">{formatMoney(t, cur as CurrencyCode, country.locale)}</p>
              {p > 0 && <p className="text-xs text-amber-600 mt-1">Por pagar: {formatMoney(p, cur as CurrencyCode, country.locale)}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <select className="select w-auto" value={filterEstado} onChange={e => setFilterEstado(e.target.value as "todos" | GastoEstado)}>
            <option value="todos">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="parcial">Parcial</option>
            <option value="pagado">Pagado</option>
          </select>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input className="input pl-9 sm:w-72" placeholder="Buscar por descripción o N° factura…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<Receipt className="w-6 h-6" />}
            title={gastos?.length ? "Sin resultados" : "Aún no hay facturas"}
            description="Registrá las facturas recibidas de tus proveedores."
            action={!gastos?.length && <button className="btn btn-primary" onClick={() => openNew()}><Plus className="w-4 h-4" /> Nueva factura</button>}
          />
        ) : (
          <table className="table text-sm">
            <thead>
              <tr>
                <th>N° Factura</th>
                <th>Proveedor</th>
                <th>Creación</th>
                <th>Vencimiento</th>
                <th>Estado</th>
                <th className="text-right">Total</th>
                <th className="text-right">Pagado</th>
                <th className="text-right">Por pagar</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(g => (
                <tr key={g.id}>
                  <td className="font-medium whitespace-nowrap">{g.numero_factura || "—"}</td>
                  <td>
                    {g.contacto_id
                      ? <Link href={`/contactos/${g.contacto_id}`} className="hover:underline hover:text-[var(--primary)]">{contactos?.find(c => c.id === g.contacto_id)?.nombre ?? `#${g.contacto_id}`}</Link>
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap text-[var(--muted)]">{formatDate(g.fecha, country.locale)}</td>
                  <td className="whitespace-nowrap text-[var(--muted)]">{g.fecha_vencimiento ? formatDate(g.fecha_vencimiento, country.locale) : "—"}</td>
                  <td>{estadoBadge(g.estado)}</td>
                  <td className="text-right font-semibold text-red-600 whitespace-nowrap">{formatMoney(Number(g.total), g.moneda, country.locale)}</td>
                  <td className="text-right text-[var(--muted)] whitespace-nowrap">
                    {formatMoney(cashPaidByFactura[g.id] ?? 0, g.moneda, country.locale)}
                  </td>
                  <td className="text-right font-medium text-amber-600 whitespace-nowrap">
                    {formatMoney(
                      Math.max(0, Math.round((Number(g.total) - (cashPaidByFactura[g.id] ?? 0) - (creditByFactura[g.id] ?? 0)) * 100) / 100),
                      g.moneda, country.locale
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {g.estado !== "pagado" && (
                      <Link
                        className="btn btn-ghost p-1.5 text-blue-600"
                        href={g.contacto_id ? `/egresos/pagos?nuevo=1&proveedor=${g.contacto_id}&factura=${g.id}` : `/egresos/pagos?nuevo=1&factura=${g.id}`}
                        title="Agregar pago"
                      >
                        <CreditCard className="w-4 h-4" />
                      </Link>
                    )}
                    <button className="btn btn-ghost p-1.5" onClick={() => openEdit(g)}><Pencil className="w-4 h-4" /></button>
                    <button className="btn btn-ghost p-1.5 text-red-600" onClick={() => remove(g)}><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Modal ── */}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Editar factura" : "Nueva factura de proveedor"} size="xl">
        <div className="space-y-5">

          {/* Moneda + tasa de cambio */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="label whitespace-nowrap">Moneda *</label>
              <select
                className="select w-44"
                value={form.moneda}
                onChange={e => setForm({ ...form, moneda: e.target.value as CurrencyCode, tasa_cambio: 1 })}
              >
                {monedas.map(code => <option key={code} value={code}>{code} — {CURRENCIES[code].name}</option>)}
              </select>
            </div>
            {isForeignCurrency && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <span className="text-sm text-amber-800 whitespace-nowrap">
                  1 {form.moneda} =
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input w-32 text-sm py-1"
                  placeholder="Tasa"
                  value={form.tasa_cambio || ""}
                  onChange={e => setForm({ ...form, tasa_cambio: parseFloat(e.target.value) || 0 })}
                />
                <span className="text-sm text-amber-800 whitespace-nowrap">{base}</span>
              </div>
            )}
          </div>

          {/* Document header */}
          <div className="border border-[var(--border)] rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">{config?.empresa_nombre}</p>
                {config?.empresa_tax_id && <p className="text-xs text-[var(--muted)]">CUIT: {config.empresa_tax_id}</p>}
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium whitespace-nowrap">No. *</label>
                <input className="input w-44 text-sm" placeholder="0001-00012345" value={form.numero_factura} onChange={e => setForm({ ...form, numero_factura: e.target.value })} />
              </div>
            </div>

            {/* Proveedor + Dates */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="label">Proveedor *</label>
                    <Link href="/contactos" className="text-xs text-[var(--primary)] hover:underline">+ Nuevo proveedor</Link>
                  </div>
                  <select
                    className="select"
                    value={form.contacto_id}
                    onChange={e => setForm({ ...form, contacto_id: e.target.value === "" ? "" : Number(e.target.value) })}
                  >
                    <option value="">— Sin proveedor —</option>
                    {proveedores.length === 0 && (
                      <option disabled>No hay proveedores — creá uno en Contactos</option>
                    )}
                    {proveedores.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
                {selectedProveedor?.tax_id && (
                  <div>
                    <label className="label">Identificación</label>
                    <input className="input bg-slate-50 text-sm" value={selectedProveedor.tax_id} readOnly />
                  </div>
                )}
                {selectedProveedor?.telefono && (
                  <div>
                    <label className="label">Teléfono</label>
                    <input className="input bg-slate-50 text-sm" value={selectedProveedor.telefono} readOnly />
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <div>
                  <label className="label">Fecha de creación *</label>
                  <input type="date" className="input" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} required />
                </div>
                <div>
                  <label className="label">Vencimiento *</label>
                  <input type="date" className="input" min={form.fecha} value={form.fecha_vencimiento} onChange={e => setForm({ ...form, fecha_vencimiento: e.target.value })} />
                </div>
              </div>
            </div>
          </div>

          {/* Items table */}
          <div className="border border-[var(--border)] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-[var(--border)]">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-[var(--muted)]">Concepto *</th>
                    <th className="text-left px-3 py-2 font-medium text-[var(--muted)] w-32">Precio *</th>
                    <th className="text-left px-3 py-2 font-medium text-[var(--muted)] w-24">IVA%</th>
                    <th className="text-left px-3 py-2 font-medium text-[var(--muted)] w-20">Cant.</th>
                    <th className="text-left px-3 py-2 font-medium text-[var(--muted)]">Observaciones</th>
                    <th className="text-right px-3 py-2 font-medium text-[var(--muted)] w-32">Total</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {form.items.map(item => (
                    <tr key={item.key} className="hover:bg-slate-50/50">
                      <td className="px-3 py-2">
                        <select className="select text-sm py-1 w-full" value={item.concepto_id} onChange={e => updateItem(item.key, { concepto_id: e.target.value })}>
                          <option value="">Seleccionar</option>
                          {conceptos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" step="0.01" min="0" className="input text-sm py-1 w-full" placeholder="0.00"
                          value={item.precio || ""} onChange={e => updateItem(item.key, { precio: parseFloat(e.target.value) || 0 })} />
                      </td>
                      <td className="px-3 py-2">
                        <select className="select text-sm py-1 w-full" value={item.impuesto} onChange={e => updateItem(item.key, { impuesto: parseFloat(e.target.value) })}>
                          {country.ivaRates.map(r => <option key={r} value={r}>{r}%</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" step="1" min="1" className="input text-sm py-1 w-full"
                          value={item.cantidad || ""} onChange={e => updateItem(item.key, { cantidad: parseFloat(e.target.value) || 1 })} />
                      </td>
                      <td className="px-3 py-2">
                        <input className="input text-sm py-1 w-full" placeholder="Opcional"
                          value={item.observaciones} onChange={e => updateItem(item.key, { observaciones: e.target.value })} />
                      </td>
                      <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                        {formatMoney(itemTotal(item), form.moneda, country.locale)}
                      </td>
                      <td className="px-2 py-2">
                        {form.items.length > 1 && (
                          <button type="button" className="text-[var(--muted)] hover:text-red-500" onClick={() => removeItem(item.key)}>
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 border-t border-[var(--border)] bg-slate-50/50">
              <button type="button" className="text-sm text-[var(--primary)] hover:underline flex items-center gap-1 font-medium" onClick={addItem}>
                <Plus className="w-3.5 h-3.5" /> Agregar línea
              </button>
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="space-y-1 text-sm w-64">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Subtotal</span>
                <span className="font-medium">{formatMoney(totals.subtotal, form.moneda, country.locale)}</span>
              </div>
              {totals.iva_monto > 0 && (
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">IVA</span>
                  <span className="font-medium">{formatMoney(totals.iva_monto, form.moneda, country.locale)}</span>
                </div>
              )}
              <div className="flex justify-between pt-1 border-t border-[var(--border)]">
                <span className="font-semibold">Total {form.moneda}</span>
                <span className="font-bold text-base">{formatMoney(totals.total, form.moneda, country.locale)}</span>
              </div>
              {isForeignCurrency && form.tasa_cambio > 0 && (
                <div className="flex justify-between text-amber-700 bg-amber-50 -mx-2 px-2 py-1 rounded">
                  <span className="font-semibold">Total {base}</span>
                  <span className="font-bold">{formatMoney(totals.total_base, base, country.locale)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Notas */}
          <div>
            <label className="label">Notas</label>
            <textarea className="textarea" rows={2} value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-[var(--border)]">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => handleSave("new")}>Guardar y crear nueva</button>
            {form.contacto_id !== "" && (
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => handleSave("pay")}>Guardar y agregar pago</button>
            )}
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => handleSave("save")}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
