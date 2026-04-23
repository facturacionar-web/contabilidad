"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTable, insertRow, updateRow, deleteRow, paisFilter } from "@/lib/useSupabaseData";
import { createClient } from "@/lib/supabase/client";
import type { Gasto, GastoEstado, FacturaPago, Retencion } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import { CURRENCIES, CurrencyCode, PAYMENT_METHODS, monedasDisponibles } from "@/lib/countries";
import { formatMoney, formatDate, todayISO } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { Plus, CreditCard, Pencil, Trash2, Search, X, ChevronDown, ChevronUp } from "lucide-react";

const TIPOS_RETENCION = ["Ganancias", "IIBB", "Otro"];

// ── Local types ────────────────────────────────────────────────────────────
type RetLocal = { key: string; tipo: string; monto: number };

type FPLocal = {
  factura_id: number;
  numero_factura: string | null;
  total_factura: number;
  monto_pagado_antes: number;
  monto: number;
  retenciones: RetLocal[];
  showRet: boolean;
};

type FormState = {
  fecha: string;
  contacto_id: number | "";
  cuenta_id: string;
  metodo_pago: string;
  moneda: CurrencyCode;
  tasa_cambio: number;
  nota: string;
  concepto: string;
  monto_directo: number;
  facturas_pagadas: FPLocal[];
};

let _rkey = 0;
const nextRKey = () => String(++_rkey);

function blank(moneda: CurrencyCode): FormState {
  return {
    fecha: todayISO(), contacto_id: "", cuenta_id: "", metodo_pago: PAYMENT_METHODS[0],
    moneda, tasa_cambio: 1, nota: "", concepto: "", monto_directo: 0, facturas_pagadas: [],
  };
}

function pagoToForm(g: Gasto): FormState {
  const fps = (g.factura_pagos ?? []).map((fp, i) => ({
    factura_id: fp.factura_id,
    numero_factura: fp.numero_factura,
    total_factura: Number(fp.total_factura),
    monto_pagado_antes: Number(fp.monto_pagado_antes),
    monto: Number(fp.monto),
    retenciones: (fp.retenciones ?? []).map((r, j) => ({ key: `${i}-${j}`, tipo: r.tipo, monto: Number(r.monto) })),
    showRet: (fp.retenciones ?? []).length > 0,
  }));
  return {
    fecha: g.fecha,
    contacto_id: g.contacto_id ?? "",
    cuenta_id: g.cuenta_id ?? "",
    metodo_pago: g.metodo_pago ?? PAYMENT_METHODS[0],
    moneda: g.moneda,
    tasa_cambio: g.tasa_cambio ?? 1,
    nota: g.notas ?? "",
    concepto: fps.length === 0 ? g.concepto : "",
    monto_directo: fps.length === 0 ? Number(g.total) : 0,
    facturas_pagadas: fps,
  };
}

// ── Component ──────────────────────────────────────────────────────────────
export default function PagosEgresosPage() {
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
  const [saving, setSaving] = useState(false);
  const autoOpenedRef = useRef(false);
  const autoEditedRef = useRef(false);
  const [preselectedFacturaId, setPreselectedFacturaId] = useState<number | null>(null);
  const preselectedRef = useRef<number | null>(null);
  const [showAllFacturas, setShowAllFacturas] = useState(false);

  function setPreselected(id: number | null) {
    preselectedRef.current = id;
    setPreselectedFacturaId(id);
  }

  const { data: pagos, reload } = useTable("gastos", {
    orderBy: "fecha",
    filter: [...(paisFilter(pais) ?? []), { column: "tipo", op: "eq", value: "gasto" }],
    skip: !pais, deps: [pais],
  });
  const { data: facturas } = useTable("gastos", {
    orderBy: "fecha",
    filter: [...(paisFilter(pais) ?? []), { column: "tipo", op: "eq", value: "factura_proveedor" }],
    skip: !pais, deps: [pais],
  });
  const { data: contactos } = useTable("contactos", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });
  const { data: cuentas } = useTable("cuentas", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });

  const proveedores = (contactos ?? []).filter(c => c.tipo === "proveedor" || c.tipo === "ambos");

  // Facturas pendientes del proveedor seleccionado
  const facturasPendientes = useMemo(() => {
    if (form.contacto_id === "") return [];
    return (facturas ?? []).filter(f =>
      f.contacto_id === Number(form.contacto_id) && f.estado !== "pagado"
    );
  }, [facturas, form.contacto_id]);

  // Sync facturas_pagadas when contacto changes
  useEffect(() => {
    if (editing) return;
    const preId = preselectedRef.current;
    const preFactura = preId ? facturasPendientes.find(f => f.id === preId) : null;
    const nuevaMoneda = (preFactura?.moneda ?? monedas[0] ?? base) as CurrencyCode;
    setForm(f => ({
      ...f,
      moneda: nuevaMoneda,
      tasa_cambio: nuevaMoneda === f.moneda ? f.tasa_cambio : 1,
      facturas_pagadas: facturasPendientes.map(fac => ({
        factura_id: fac.id,
        numero_factura: fac.numero_factura ?? null,
        total_factura: Number(fac.total),
        monto_pagado_antes: Number(fac.monto_pagado),
        monto: preId && fac.id === preId ? Number(fac.total) - Number(fac.monto_pagado) : 0,
        retenciones: [] as RetLocal[],
        showRet: false,
      })),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.contacto_id, facturasPendientes.length]);

  const filtered = (pagos ?? []).filter(g => {
    if (!search) return true;
    const q = search.toLowerCase();
    return g.concepto.toLowerCase().includes(q);
  });

  const isForeign = form.moneda !== base;

  const totals = useMemo(() => {
    if (form.contacto_id === "") {
      const net = form.monto_directo;
      return { aplicado: net, retenciones: 0, neto: net, neto_base: net * (form.tasa_cambio || 1) };
    }
    const aplicado = form.facturas_pagadas.reduce((s, fp) => s + fp.monto, 0);
    const retenciones = form.facturas_pagadas.reduce((s, fp) => s + fp.retenciones.reduce((sr, r) => sr + r.monto, 0), 0);
    const neto = aplicado - retenciones;
    return { aplicado, retenciones, neto, neto_base: neto * (form.tasa_cambio || 1) };
  }, [form]);

  function openNew(proveedorId?: number, facturaId?: number) {
    setEditing(null);
    setPreselected(facturaId ?? null);
    setShowAllFacturas(false);
    const f = blank(monedas[0] ?? base);
    if (proveedorId) f.contacto_id = proveedorId;
    setForm(f);
    setOpen(true);
  }

  useEffect(() => {
    if (autoOpenedRef.current || !pais || searchParams.get("nuevo") !== "1") return;
    const p = searchParams.get("proveedor");
    const fId = searchParams.get("factura");
    autoOpenedRef.current = true;
    openNew(p ? Number(p) : undefined, fId ? Number(fId) : undefined);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("nuevo"); params.delete("proveedor"); params.delete("factura");
    const qs = params.toString();
    router.replace(qs ? `/egresos/pagos?${qs}` : "/egresos/pagos");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pais, searchParams]);

  useEffect(() => {
    if (autoEditedRef.current || !pais || !pagos || !searchParams.get("editar")) return;
    const editId = Number(searchParams.get("editar"));
    const pago = pagos.find(p => p.id === editId);
    if (!pago) return;
    autoEditedRef.current = true;
    openEdit(pago);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("editar");
    const qs = params.toString();
    router.replace(qs ? `/egresos/pagos?${qs}` : "/egresos/pagos");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pais, pagos, searchParams]);

  function openEdit(g: Gasto) {
    setEditing(g);
    setPreselected(null);
    setShowAllFacturas(false);
    setForm(pagoToForm(g));
    setOpen(true);
  }

  const displayedFacturas = useMemo(() => {
    if (!preselectedFacturaId || showAllFacturas) return form.facturas_pagadas;
    return form.facturas_pagadas.filter(fp => fp.factura_id === preselectedFacturaId);
  }, [form.facturas_pagadas, preselectedFacturaId, showAllFacturas]);

  // ── Item helpers ──
  function setFP(id: number, patch: Partial<FPLocal>) {
    setForm(f => ({ ...f, facturas_pagadas: f.facturas_pagadas.map(fp => fp.factura_id === id ? { ...fp, ...patch } : fp) }));
  }
  function addRetencion(factura_id: number) {
    setForm(f => ({
      ...f,
      facturas_pagadas: f.facturas_pagadas.map(fp =>
        fp.factura_id === factura_id
          ? { ...fp, showRet: true, retenciones: [...fp.retenciones, { key: nextRKey(), tipo: TIPOS_RETENCION[0], monto: 0 }] }
          : fp
      ),
    }));
  }
  function removeRetencion(factura_id: number, rkey: string) {
    setForm(f => ({
      ...f,
      facturas_pagadas: f.facturas_pagadas.map(fp =>
        fp.factura_id === factura_id
          ? { ...fp, retenciones: fp.retenciones.filter(r => r.key !== rkey) }
          : fp
      ),
    }));
  }
  function updateRetencion(factura_id: number, rkey: string, patch: Partial<RetLocal>) {
    setForm(f => ({
      ...f,
      facturas_pagadas: f.facturas_pagadas.map(fp =>
        fp.factura_id === factura_id
          ? { ...fp, retenciones: fp.retenciones.map(r => r.key === rkey ? { ...r, ...patch } : r) }
          : fp
      ),
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { neto } = totals;
      const hasContacto = form.contacto_id !== "";
      const fpData = form.facturas_pagadas.filter(fp => fp.monto > 0);

      const facturaPagosPayload: FacturaPago[] = fpData.map(fp => ({
        factura_id: fp.factura_id,
        numero_factura: fp.numero_factura,
        total_factura: fp.total_factura,
        monto_pagado_antes: fp.monto_pagado_antes,
        monto: fp.monto,
        retenciones: fp.retenciones.map(r => ({ tipo: r.tipo, monto: r.monto }) as Retencion),
      }));

      // Concepto del pago
      const proveedor = proveedores.find(c => c.id === Number(form.contacto_id));
      const concepto = hasContacto && fpData.length > 0
        ? `Pago a ${proveedor?.nombre ?? "proveedor"} — ${fpData.map(fp => fp.numero_factura ?? `#${fp.factura_id}`).join(", ")}`
        : form.concepto || "Pago";

      const payload = {
        ctx_pais: pais,
        fecha: form.fecha,
        tipo: "gasto" as const,
        contacto_id: form.contacto_id === "" ? null : Number(form.contacto_id),
        cuenta_id: form.cuenta_id || null,
        concepto,
        categoria: concepto,
        concepto_id: null,
        subtotal: neto,
        iva: 0,
        iva_monto: 0,
        total: neto,
        moneda: form.moneda,
        tasa_cambio: form.tasa_cambio,
        estado: "pagado" as GastoEstado,
        metodo_pago: form.metodo_pago || null,
        monto_pagado: neto,
        notas: form.nota || null,
        factura_pagos: facturaPagosPayload.length > 0 ? facturaPagosPayload : null,
      };

      if (editing) {
        await updateRow("gastos", editing.id, payload);
      } else {
        await insertRow("gastos", payload);
      }

      // Update each linked factura
      for (const fp of fpData) {
        const factura = (facturas ?? []).find(f => f.id === fp.factura_id);
        if (!factura) continue;
        const raw = Number(factura.monto_pagado) + fp.monto;
        const nuevo_pagado = Math.round(raw * 100) / 100;
        const total_factura = Math.round(Number(factura.total) * 100) / 100;
        const nuevo_estado: GastoEstado = nuevo_pagado >= total_factura ? "pagado" : "parcial";
        await updateRow("gastos", fp.factura_id, {
          monto_pagado: Math.min(nuevo_pagado, total_factura),
          estado: nuevo_estado,
        });
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
      const supabase = createClient();
      const fps = g.factura_pagos ?? [];
      for (const fp of fps) {
        const { data: factura } = await supabase.from("gastos").select("*").eq("id", fp.factura_id).single();
        if (!factura) continue;
        const nuevo_pagado = Math.max(0, Number(factura.monto_pagado) - Number(fp.monto));
        const nuevo_estado: GastoEstado =
          nuevo_pagado <= 0 ? "pendiente" : nuevo_pagado >= Number(factura.total) ? "pagado" : "parcial";
        await updateRow("gastos", fp.factura_id, { monto_pagado: nuevo_pagado, estado: nuevo_estado });
      }
      await deleteRow("gastos", g.id);
      await reload();
    } catch (err) { alert("Error: " + (err as Error).message); }
  }

  return (
    <>
      <PageHeader
        title="Pagos"
        description="Pagos a proveedores y gastos directos"
        action={<button className="btn btn-primary" onClick={() => openNew()}><Plus className="w-4 h-4" /> Nuevo pago</button>}
      />

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input className="input pl-9 sm:w-72" placeholder="Buscar pagos…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<CreditCard className="w-6 h-6" />}
            title={pagos?.length ? "Sin resultados" : "Aún no hay pagos"}
            description="Registrá pagos a proveedores o gastos directos."
            action={!pagos?.length && <button className="btn btn-primary" onClick={() => openNew()}><Plus className="w-4 h-4" /> Nuevo pago</button>}
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th><th>Descripción</th><th>Proveedor</th>
                <th>Cuenta</th><th>Método</th>
                <th className="text-right">Monto</th><th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(g => {
                const fps = g.factura_pagos ?? [];
                return (
                  <tr key={g.id}>
                    <td className="whitespace-nowrap">{formatDate(g.fecha, country.locale)}</td>
                    <td className="max-w-xs">
                      <p className="font-medium truncate">{g.concepto}</p>
                      {fps.length > 0 && (
                        <p className="text-xs text-[var(--muted)]">
                          Facturas: {fps.map(fp => fp.numero_factura ?? `#${fp.factura_id}`).join(", ")}
                        </p>
                      )}
                    </td>
                    <td className="text-[var(--muted)]">{contactos?.find(c => c.id === g.contacto_id)?.nombre ?? "—"}</td>
                    <td className="text-[var(--muted)]">{(cuentas ?? []).find(c => c.id === g.cuenta_id)?.nombre ?? "—"}</td>
                    <td className="text-[var(--muted)]">{g.metodo_pago ?? "—"}</td>
                    <td className="text-right font-semibold text-red-600 whitespace-nowrap">
                      -{formatMoney(Number(g.total), g.moneda, country.locale)}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn btn-ghost p-1.5" onClick={() => openEdit(g)}><Pencil className="w-4 h-4" /></button>
                      <button className="btn btn-ghost p-1.5 text-red-600" onClick={() => remove(g)}><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Modal ── */}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Editar pago" : "Nuevo pago"} size="xl">
        <div className="space-y-5">

          {/* General info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Contacto / Proveedor</label>
              <select className="select" value={form.contacto_id}
                onChange={e => {
                  setPreselected(null);
                  setShowAllFacturas(false);
                  setForm(f => ({ ...f, contacto_id: e.target.value === "" ? "" : Number(e.target.value), facturas_pagadas: [] }));
                }}>
                <option value="">— Sin contacto —</option>
                {proveedores.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Cuenta bancaria</label>
              <select className="select" value={form.cuenta_id} onChange={e => setForm(f => ({ ...f, cuenta_id: e.target.value }))}>
                <option value="">— Sin cuenta —</option>
                {(cuentas ?? []).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Fecha *</label>
              <input type="date" className="input" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} required />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Forma de pago</label>
              <select className="select" value={form.metodo_pago} onChange={e => setForm(f => ({ ...f, metodo_pago: e.target.value }))}>
                {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Moneda *</label>
              <select className="select" value={form.moneda}
                onChange={e => setForm(f => ({ ...f, moneda: e.target.value as CurrencyCode, tasa_cambio: 1 }))}>
                {monedas.map(code => <option key={code} value={code}>{code} — {CURRENCIES[code].name}</option>)}
              </select>
            </div>
            {isForeign && (
              <div>
                <label className="label">Tasa de cambio</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[var(--muted)]">1 {form.moneda} =</span>
                  <input type="number" step="0.01" min="0" className="input flex-1"
                    value={form.tasa_cambio || ""} onChange={e => setForm(f => ({ ...f, tasa_cambio: parseFloat(e.target.value) || 0 }))} />
                  <span className="text-sm text-[var(--muted)]">{base}</span>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="label">Nota de egreso</label>
            <textarea className="textarea" rows={2} value={form.nota} onChange={e => setForm(f => ({ ...f, nota: e.target.value }))} />
          </div>

          {/* Pago directo (sin facturas) */}
          {form.contacto_id === "" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Descripción *</label>
                <input className="input" placeholder="¿En qué se gastó?" value={form.concepto}
                  onChange={e => setForm(f => ({ ...f, concepto: e.target.value }))} />
              </div>
              <div>
                <label className="label">Monto *</label>
                <input type="number" step="0.01" min="0" className="input" value={form.monto_directo || ""}
                  onChange={e => setForm(f => ({ ...f, monto_directo: parseFloat(e.target.value) || 0 }))} />
              </div>
            </div>
          )}

          {/* Facturas pendientes */}
          {form.contacto_id !== "" && (
            <div className="border border-[var(--border)] rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Facturas pendientes</p>
                  <p className="text-xs text-[var(--muted)]">Ingresá el monto a aplicar a cada factura</p>
                </div>
                {preselectedFacturaId !== null && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showAllFacturas}
                      onChange={e => setShowAllFacturas(e.target.checked)}
                      className="rounded"
                    />
                    Ver todas las pendientes
                  </label>
                )}
              </div>

              {form.facturas_pagadas.length === 0 ? (
                <p className="px-4 py-6 text-sm text-center text-[var(--muted)]">No hay facturas pendientes para este proveedor</p>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {displayedFacturas.map(fp => {
                    const porPagar = fp.total_factura - fp.monto_pagado_antes;
                    const totalRet = fp.retenciones.reduce((s, r) => s + r.monto, 0);
                    return (
                      <div key={fp.factura_id} className="px-4 py-3 space-y-2">
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
                          <div>
                            <p className="text-xs text-[var(--muted)]">N° Factura</p>
                            <p className="text-sm font-medium">{fp.numero_factura || `#${fp.factura_id}`}</p>
                          </div>
                          <div>
                            <p className="text-xs text-[var(--muted)]">Total</p>
                            <p className="text-sm">{formatMoney(fp.total_factura, form.moneda, country.locale)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-[var(--muted)]">Pagado</p>
                            <p className="text-sm">{formatMoney(fp.monto_pagado_antes, form.moneda, country.locale)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-[var(--muted)]">Por pagar</p>
                            <p className="text-sm font-medium text-amber-600">{formatMoney(porPagar, form.moneda, country.locale)}</p>
                          </div>
                          <div>
                            <label className="text-xs text-[var(--muted)]">Monto a pagar *</label>
                            <input type="number" step="0.01" min="0" className="input text-sm py-1"
                              placeholder="0.00" value={fp.monto || ""}
                              onChange={e => setFP(fp.factura_id, { monto: parseFloat(e.target.value) || 0 })} />
                          </div>
                        </div>

                        {/* Retenciones */}
                        <div className="ml-1">
                          {fp.retenciones.map(r => (
                            <div key={r.key} className="flex items-center gap-2 mt-1.5">
                              <select className="select text-xs py-1 w-36"
                                value={r.tipo} onChange={e => updateRetencion(fp.factura_id, r.key, { tipo: e.target.value })}>
                                {TIPOS_RETENCION.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                              <input type="number" step="0.01" min="0" className="input text-xs py-1 w-36"
                                placeholder="Monto" value={r.monto || ""}
                                onChange={e => updateRetencion(fp.factura_id, r.key, { monto: parseFloat(e.target.value) || 0 })} />
                              <button type="button" className="text-[var(--muted)] hover:text-red-500"
                                onClick={() => removeRetencion(fp.factura_id, r.key)}>
                                <X className="w-3.5 h-3.5" />
                              </button>
                              <span className="text-xs text-[var(--muted)]">retención</span>
                            </div>
                          ))}
                          <button type="button"
                            className="text-xs text-[var(--primary)] hover:underline mt-1.5 flex items-center gap-1"
                            onClick={() => addRetencion(fp.factura_id)}>
                            <Plus className="w-3 h-3" /> Agregar retención
                          </button>
                          {totalRet > 0 && (
                            <p className="text-xs text-slate-500 mt-1">
                              Total retenciones: {formatMoney(totalRet, form.moneda, country.locale)} →
                              Transferir: {formatMoney(fp.monto - totalRet, form.moneda, country.locale)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Totals */}
          {(totals.neto > 0 || form.contacto_id !== "") && (
            <div className="flex justify-end">
              <div className="space-y-1 text-sm w-72">
                {isForeign && (
                  <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                    <span className="text-amber-800 text-sm">1 {form.moneda} =</span>
                    <input
                      type="number" step="0.01" min="0"
                      className="input w-32 text-sm py-1 mx-2"
                      placeholder="Tasa de cambio"
                      value={form.tasa_cambio || ""}
                      onChange={e => setForm(f => ({ ...f, tasa_cambio: parseFloat(e.target.value) || 0 }))}
                    />
                    <span className="text-amber-800 text-sm">{base}</span>
                  </div>
                )}
                {form.contacto_id !== "" && totals.retenciones > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-[var(--muted)]">Total aplicado a facturas</span>
                      <span>{formatMoney(totals.aplicado, form.moneda, country.locale)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--muted)]">Total retenciones</span>
                      <span className="text-amber-600">-{formatMoney(totals.retenciones, form.moneda, country.locale)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between pt-1 border-t border-[var(--border)]">
                  <span className="font-semibold">Total {form.moneda}</span>
                  <span className="font-bold text-base text-red-600">{formatMoney(totals.neto, form.moneda, country.locale)}</span>
                </div>
                {isForeign && form.tasa_cambio > 0 && (
                  <div className="flex justify-between text-amber-700 bg-amber-50 -mx-2 px-2 py-1 rounded">
                    <span className="font-semibold">Total {base}</span>
                    <span className="font-bold">{formatMoney(totals.neto_base, base, country.locale)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
