"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useTable, insertRow, updateRow, deleteRow, paisFilter } from "@/lib/useSupabaseData";
import type { NotaCredito, GastoEstado } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import { CURRENCIES, CurrencyCode, monedasDisponibles } from "@/lib/countries";
import { formatMoney, formatDate, todayISO, parseMonto } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import Link from "next/link";
import { Plus, FileMinus, Pencil, Trash2, Search, X, RotateCcw, Loader2 } from "lucide-react";
import SearchableSelect from "@/components/SearchableSelect";
import EntityMeta from "@/components/EntityMeta";
import TasaCambioButton from "@/components/TasaCambioButton";

function calcAplicado(n: NotaCredito): number {
  type AP = { monto: number };
  const aps = ((n as unknown as { factura_aplicaciones?: AP[] }).factura_aplicaciones ?? []);
  let aplicado = aps.reduce((s, a) => s + Number(a.monto), 0);
  if (aps.length === 0 && n.gasto_relacionado_id) aplicado = Number(n.monto);
  try {
    const mot = JSON.parse(n.motivo || "");
    if (mot?.devolucion?.monto) aplicado += Number(mot.devolucion.monto);
  } catch { /* ok */ }
  return Math.min(Math.round(aplicado * 100) / 100, Number(n.monto));
}

let _key = 0;
const nextKey = () => String(++_key);

type LineaNC = { key: string; concepto_id: string; monto: number };
type AplicacionFac = {
  key: string;
  factura_id: number;
  numero_factura: string | null;
  total_factura: number;
  monto_pagado_antes: number;
  monto: number;
};

type DevolucionData = {
  fecha: string;
  cuenta_id: string;
  monto: number;
  observaciones: string;
};

type FormState = {
  fecha: string;
  contacto_id: number | "";
  numero: string;
  moneda: CurrencyCode;
  tasa_cambio: number;
  notas_text: string;
  lineas: LineaNC[];
  aplicaciones: AplicacionFac[];
  devolucion: DevolucionData | null;
};

function getLastTasaNC(moneda: string): number {
  if (typeof window === "undefined") return 1;
  const s = localStorage.getItem(`last_tasa_${moneda}`);
  return s ? parseFloat(s) || 1 : 1;
}
function saveLastTasaNC(moneda: string, t: number): void {
  if (typeof window === "undefined" || t <= 0) return;
  localStorage.setItem(`last_tasa_${moneda}`, String(t));
}

function blank(moneda: CurrencyCode): FormState {
  return {
    fecha: todayISO(),
    contacto_id: "",
    numero: "",
    moneda,
    tasa_cambio: getLastTasaNC(moneda),
    notas_text: "",
    lineas: [{ key: nextKey(), concepto_id: "", monto: 0 }],
    aplicaciones: [],
    devolucion: null,
  };
}

export default function NotasCreditoPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const monedas = pais ? monedasDisponibles(pais) : (["MXN"] as CurrencyCode[]);
  const searchParams = useSearchParams();
  const autoEditId = searchParams ? Number(searchParams.get("editar")) || null : null;
  const autoEditDone = useRef(false);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NotaCredito | null>(null);
  const [form, setForm] = useState<FormState>(blank("MXN"));
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const { data: notas, reload, loading } = useTable("notas_credito", {
    orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais],
  });
  const { data: contactos } = useTable("contactos", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });
  const { data: gastos } = useTable("gastos", {
    orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais],
  });
  const { data: conceptosAll } = useTable("conceptos", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });
  const { data: cuentas } = useTable("cuentas", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });

  const proveedores = (contactos ?? []).filter(c => c.tipo === "proveedor" || c.tipo === "ambos");
  const conceptos = (conceptosAll ?? []).filter(c => c.tipo === "egreso" || c.tipo === "ambos");
  const todasFacturas = (gastos ?? []).filter(g => g.tipo === "factura_proveedor");

  const facturasPendientes = useMemo(() => {
    if (form.contacto_id === "") return [];
    const enForm = new Set(form.aplicaciones.map(a => a.factura_id));
    return todasFacturas.filter(f =>
      f.contacto_id === Number(form.contacto_id) &&
      f.estado !== "pagado" &&
      f.moneda === form.moneda &&
      !enForm.has(f.id)
    );
  }, [todasFacturas, form.contacto_id, form.moneda, form.aplicaciones]);

  const totalLineas = form.lineas.reduce((s, l) => s + l.monto, 0);
  const totalAplicado = form.aplicaciones.reduce((s, a) => s + a.monto, 0);
  const montoDevolucion = form.devolucion?.monto ?? 0;
  const sinAsignar = Math.round((totalLineas - totalAplicado - montoDevolucion) * 100) / 100;

  const filtered = (notas ?? []).filter(n => {
    if (!search) return true;
    const q = search.toLowerCase();
    return n.concepto.toLowerCase().includes(q) || (n.numero?.toLowerCase() ?? "").includes(q);
  });

  useEffect(() => {
    if (!autoEditId || autoEditDone.current || !notas || !gastos) return;
    const n = notas.find(x => x.id === autoEditId);
    if (!n) return;
    autoEditDone.current = true;
    openEdit(n);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEditId, notas, gastos]);

  function openNew() {
    setEditing(null);
    setForm(blank(monedas[0]));
    setShowPicker(false);
    setOpen(true);
  }

  // Atajo N
  useEffect(() => {
    const handler = () => openNew();
    window.addEventListener("app:new", handler);
    return () => window.removeEventListener("app:new", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monedas]);

  function openEdit(n: NotaCredito) {
    setEditing(n);
    setShowPicker(false);
    const aps = ((n as unknown as { factura_aplicaciones?: AplicacionFac[] }).factura_aplicaciones ?? []);
    const aplicaciones: AplicacionFac[] = aps.length > 0
      ? aps.map(a => ({ ...a, key: nextKey() }))
      : n.gasto_relacionado_id
        ? [{
            key: nextKey(),
            factura_id: n.gasto_relacionado_id,
            numero_factura: todasFacturas.find(f => f.id === n.gasto_relacionado_id)?.numero_factura ?? null,
            total_factura: Number(todasFacturas.find(f => f.id === n.gasto_relacionado_id)?.total ?? 0),
            monto_pagado_antes: Number(todasFacturas.find(f => f.id === n.gasto_relacionado_id)?.monto_pagado ?? 0),
            monto: Number(n.monto),
          }]
        : [];
    let devolucion: DevolucionData | null = null;
    let lineas: LineaNC[] = [{ key: nextKey(), concepto_id: "", monto: Number(n.monto) }];
    try {
      const motParsed = n.motivo ? JSON.parse(n.motivo) : null;
      if (motParsed?.devolucion) devolucion = { ...motParsed.devolucion };
      if (Array.isArray(motParsed?.lineas) && motParsed.lineas.length > 0) {
        lineas = motParsed.lineas.map((l: { concepto_id: string; monto: number }) => ({
          key: nextKey(),
          concepto_id: l.concepto_id ?? "",
          monto: Number(l.monto),
        }));
      }
    } catch { /* ignore */ }
    setForm({
      fecha: n.fecha,
      contacto_id: n.contacto_id ?? "",
      numero: n.numero ?? "",
      moneda: n.moneda as CurrencyCode,
      tasa_cambio: Number(n.tasa_cambio ?? 1),
      notas_text: n.notas ?? "",
      lineas,
      aplicaciones,
      devolucion,
    });
    setOpen(true);
  }

  // ── Line helpers ──
  function addLinea() {
    setForm(f => ({ ...f, lineas: [...f.lineas, { key: nextKey(), concepto_id: "", monto: 0 }] }));
  }
  function removeLinea(key: string) {
    if (form.lineas.length === 1) return;
    setForm(f => ({ ...f, lineas: f.lineas.filter(l => l.key !== key) }));
  }
  function updateLinea(key: string, patch: Partial<LineaNC>) {
    setForm(f => ({ ...f, lineas: f.lineas.map(l => l.key === key ? { ...l, ...patch } : l) }));
  }

  // ── Aplicacion helpers ──
  function addFactura(factura_id: number) {
    const fac = todasFacturas.find(f => f.id === factura_id);
    if (!fac) return;
    const porPagar = Number(fac.total) - Number(fac.monto_pagado);
    const yaAplicado = form.aplicaciones.reduce((s, a) => s + a.monto, 0);
    const disponible = Math.max(0, totalLineas - yaAplicado);
    setForm(f => ({
      ...f,
      aplicaciones: [...f.aplicaciones, {
        key: nextKey(),
        factura_id: fac.id,
        numero_factura: fac.numero_factura ?? null,
        total_factura: Number(fac.total),
        monto_pagado_antes: Number(fac.monto_pagado),
        monto: Math.min(porPagar, disponible),
      }],
    }));
    setShowPicker(false);
  }
  function removeAplicacion(key: string) {
    setForm(f => ({ ...f, aplicaciones: f.aplicaciones.filter(a => a.key !== key) }));
  }
  function updateAplicacion(key: string, monto: number) {
    setForm(f => ({ ...f, aplicaciones: f.aplicaciones.map(a => a.key === key ? { ...a, monto } : a) }));
  }

  // ── Save ──
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (form.contacto_id === "") { alert("El proveedor es obligatorio."); return; }
    if (!form.numero.trim()) { alert("El número de nota de crédito es obligatorio."); return; }
    if (!form.lineas.some(l => l.concepto_id && l.monto > 0)) { alert("Debés seleccionar al menos un concepto con monto."); return; }
    if (totalLineas <= 0) { alert("El monto total debe ser mayor a cero."); return; }
    const disponibleParaDevolucion = Math.max(0, totalLineas - totalAplicado);
    if (form.devolucion && form.devolucion.monto > disponibleParaDevolucion + 0.001) {
      alert(`La devolución no puede superar ${formatMoney(disponibleParaDevolucion, form.moneda, country.locale)}.`);
      return;
    }
    if (sinAsignar > 0.01) {
      if (!confirm(`Quedan ${formatMoney(sinAsignar, form.moneda, country.locale)} sin asignar. ¿Guardar igual?`)) return;
    }
    setSaving(true);
    try {
      const conceptoNombre = form.lineas
        .filter(l => l.monto > 0)
        .map(l => conceptos.find(c => c.id === l.concepto_id)?.nombre ?? "")
        .filter(Boolean).join(", ") || "Nota de crédito";

      // Handle devolucion ingreso (delete old if editing, create new)
      let ingresoId: number | null = null;
      if (editing) {
        try {
          const motParsed = editing.motivo ? JSON.parse(editing.motivo) : null;
          if (motParsed?.ingreso_id) {
            await deleteRow("ingresos", motParsed.ingreso_id);
          }
        } catch { /* ignore */ }
      }
      if (form.devolucion && form.devolucion.cuenta_id && form.devolucion.monto > 0) {
        const ingreso = await insertRow("ingresos", {
          ctx_pais: pais,
          fecha: form.devolucion.fecha,
          tipo: "ingreso_dinero" as const,
          contacto_id: !form.contacto_id ? null : Number(form.contacto_id),
          concepto: `Devolución NC${form.numero ? " " + form.numero : ""}`,
          categoria: "devolución",
          cuenta_id: form.devolucion.cuenta_id,
          monto: form.devolucion.monto,
          moneda: form.moneda,
          metodo_pago: "transferencia",
          notas: form.devolucion.observaciones || null,
        });
        ingresoId = ingreso.id;
      }

      const motivoData: Record<string, unknown> = {
        lineas: form.lineas.map(l => ({ concepto_id: l.concepto_id, monto: l.monto })),
      };
      if (ingresoId) {
        motivoData.ingreso_id = ingresoId;
        motivoData.devolucion = form.devolucion;
      }
      const motivo = JSON.stringify(motivoData);

      const payload = {
        ctx_pais: pais,
        fecha: form.fecha,
        tipo: "recibida" as const,
        contacto_id: !form.contacto_id ? null : Number(form.contacto_id),
        numero: form.numero || null,
        gasto_relacionado_id: form.aplicaciones[0]?.factura_id ?? null,
        concepto: conceptoNombre,
        monto: totalLineas,
        moneda: form.moneda,
        tasa_cambio: form.tasa_cambio || 1,
        motivo,
        notas: form.notas_text || null,
        factura_aplicaciones: form.aplicaciones.map(a => ({
          factura_id: a.factura_id,
          numero_factura: a.numero_factura,
          total_factura: a.total_factura,
          monto_pagado_antes: a.monto_pagado_antes,
          monto: a.monto,
        })),
      };

      // Revert old applications if editing
      if (editing) {
        const oldAps = ((editing as unknown as { factura_aplicaciones?: AplicacionFac[] }).factura_aplicaciones ?? []);
        if (oldAps.length > 0) {
          for (const ap of oldAps) {
            const fac = (gastos ?? []).find(g => g.id === ap.factura_id);
            if (!fac) continue;
            const revertido = Math.max(0, Math.round((Number(fac.monto_pagado) - ap.monto) * 100) / 100);
            const total = Math.round(Number(fac.total) * 100) / 100;
            const estado: GastoEstado = revertido <= 0 ? "pendiente" : revertido >= total ? "pagado" : "parcial";
            await updateRow("gastos", ap.factura_id, { monto_pagado: revertido, estado });
          }
        } else if (editing.gasto_relacionado_id) {
          const fac = (gastos ?? []).find(g => g.id === editing.gasto_relacionado_id);
          if (fac) {
            const revertido = Math.max(0, Math.round((Number(fac.monto_pagado) - Number(editing.monto)) * 100) / 100);
            const total = Math.round(Number(fac.total) * 100) / 100;
            const estado: GastoEstado = revertido <= 0 ? "pendiente" : revertido >= total ? "pagado" : "parcial";
            await updateRow("gastos", editing.gasto_relacionado_id, { monto_pagado: revertido, estado });
          }
        }
        await updateRow("notas_credito", editing.id, payload);
      } else {
        await insertRow("notas_credito", payload);
      }

      // Apply credit to each factura
      for (const ap of form.aplicaciones) {
        const fac = (gastos ?? []).find(g => g.id === ap.factura_id);
        if (!fac) continue;
        const nuevo_pagado = Math.min(
          Math.round((Number(fac.monto_pagado) + ap.monto) * 100) / 100,
          Math.round(Number(fac.total) * 100) / 100
        );
        const total = Math.round(Number(fac.total) * 100) / 100;
        const estado: GastoEstado = nuevo_pagado >= total ? "pagado" : nuevo_pagado > 0 ? "parcial" : "pendiente";
        await updateRow("gastos", ap.factura_id, { monto_pagado: nuevo_pagado, estado });
      }

      await reload();
      setOpen(false);
    } catch (err) {
      alert("Error: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // ── Remove ──
  async function remove(n: NotaCredito) {
    if (!confirm("¿Eliminar esta nota de crédito?")) return;
    try {
      // Delete linked devolucion ingreso if exists
      try {
        const motParsed = n.motivo ? JSON.parse(n.motivo) : null;
        if (motParsed?.ingreso_id) await deleteRow("ingresos", motParsed.ingreso_id);
      } catch { /* ignore */ }

      const aps = ((n as unknown as { factura_aplicaciones?: AplicacionFac[] }).factura_aplicaciones ?? []);
      if (aps.length > 0) {
        for (const ap of aps) {
          const fac = (gastos ?? []).find(g => g.id === ap.factura_id);
          if (!fac) continue;
          const revertido = Math.max(0, Math.round((Number(fac.monto_pagado) - ap.monto) * 100) / 100);
          const total = Math.round(Number(fac.total) * 100) / 100;
          const estado: GastoEstado = revertido <= 0 ? "pendiente" : revertido >= total ? "pagado" : "parcial";
          await updateRow("gastos", ap.factura_id, { monto_pagado: revertido, estado });
        }
      } else if (n.gasto_relacionado_id) {
        const fac = (gastos ?? []).find(g => g.id === n.gasto_relacionado_id);
        if (fac) {
          const revertido = Math.max(0, Math.round((Number(fac.monto_pagado) - Number(n.monto)) * 100) / 100);
          const total = Math.round(Number(fac.total) * 100) / 100;
          const estado: GastoEstado = revertido <= 0 ? "pendiente" : revertido >= total ? "pagado" : "parcial";
          await updateRow("gastos", n.gasto_relacionado_id, { monto_pagado: revertido, estado });
        }
      }
      await deleteRow("notas_credito", n.id);
      await reload();
    } catch (err) {
      alert("Error: " + (err as Error).message);
    }
  }

  const totalRecibidas = (notas ?? []).reduce<Record<string, number>>((acc, n) => {
    if (n.tipo !== "recibida") return acc;
    acc[n.moneda] = (acc[n.moneda] ?? 0) + Number(n.monto);
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Notas de crédito"
        description="Notas de crédito recibidas de proveedores"
        action={<button className="btn btn-primary" onClick={openNew}><Plus className="w-4 h-4" /> Nueva nota</button>}
      />

      {Object.keys(totalRecibidas).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {Object.entries(totalRecibidas).map(([cur, t]) => (
            <div key={cur} className="card py-3">
              <p className="text-xs text-[var(--muted)]">Total recibidas {cur}</p>
              <p className="text-lg font-semibold text-teal-600">{formatMoney(t, cur as CurrencyCode, country.locale)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input className="input pl-9 sm:w-72" placeholder="Buscar por concepto o número…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--muted)]" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<FileMinus className="w-6 h-6" />}
            title={notas?.length ? "Sin resultados" : "Aún no hay notas de crédito"}
            description="Registrá notas de crédito recibidas de proveedores."
            action={!notas?.length && <button className="btn btn-primary" onClick={openNew}><Plus className="w-4 h-4" /> Nueva nota</button>}
          />
        ) : (
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Fecha</th><th>Número</th><th>Concepto</th><th>Proveedor</th>
                <th>Facturas aplicadas</th>
                <th className="text-right">Monto</th>
                <th className="text-right">Aplicado</th>
                <th className="text-right">Por aplicar</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(n => {
                const aps = ((n as unknown as { factura_aplicaciones?: AplicacionFac[] }).factura_aplicaciones ?? []);
                const aplicado = calcAplicado(n);
                const porAplicar = Math.max(0, Math.round((Number(n.monto) - aplicado) * 100) / 100);
                return (
                  <tr key={n.id}>
                    <td className="whitespace-nowrap">{formatDate(n.fecha, country.locale)}</td>
                    <td>
                      {n.numero ? (
                        <button
                          type="button"
                          onClick={() => openEdit(n)}
                          className="text-[var(--primary)] hover:underline font-medium"
                        >
                          {n.numero}
                        </button>
                      ) : (
                        <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                    <td className="font-medium max-w-xs truncate">{n.concepto}</td>
                    <td className="text-[var(--muted)]">
                      {n.contacto_id
                        ? <Link href={`/contactos/${n.contacto_id}`} className="hover:underline hover:text-[var(--primary)]">{contactos?.find(c => c.id === n.contacto_id)?.nombre ?? "—"}</Link>
                        : "—"}
                    </td>
                    <td className="text-[var(--muted)]">
                      {aps.length > 0
                        ? aps.map(a => a.numero_factura ?? `#${a.factura_id}`).join(", ")
                        : n.gasto_relacionado_id
                          ? (todasFacturas.find(f => f.id === n.gasto_relacionado_id)?.numero_factura ?? `#${n.gasto_relacionado_id}`)
                          : <span className="text-teal-600 text-xs">Devolución</span>}
                    </td>
                    <td className="text-right font-semibold whitespace-nowrap">
                      {formatMoney(Number(n.monto), n.moneda as CurrencyCode, country.locale)}
                    </td>
                    <td className="text-right text-[var(--muted)] whitespace-nowrap">
                      {formatMoney(aplicado, n.moneda as CurrencyCode, country.locale)}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {porAplicar > 0.005
                        ? <span className="text-amber-600 font-medium">{formatMoney(porAplicar, n.moneda as CurrencyCode, country.locale)}</span>
                        : <span className="text-teal-600 text-xs">Aplicado</span>}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn btn-ghost p-1.5" onClick={() => openEdit(n)}><Pencil className="w-4 h-4" /></button>
                      <button className="btn btn-ghost p-1.5 text-red-600" onClick={() => remove(n)}><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Modal ── */}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Editar nota de crédito" : "Nueva nota de crédito"} size="xl">
        <form onSubmit={save} className="space-y-5">
          {editing && (
            <EntityMeta entity="notas_credito" entityId={editing.id} variant="block" />
          )}

          {/* Header fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Proveedor *</label>
              <SearchableSelect
                value={form.contacto_id}
                onChange={v => setForm(f => ({ ...f, contacto_id: v === "" ? "" : Number(v), aplicaciones: [] }))}
                options={proveedores.map(c => ({ value: c.id, label: c.nombre }))}
                placeholder="— Sin proveedor —"
                emptyLabel="— Sin proveedor —"
              />
            </div>
            <div>
              <label className="label">Número *</label>
              <input className="input" value={form.numero} onChange={e => setForm(f => ({ ...f, numero: e.target.value }))} required />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Fecha *</label>
              <input type="date" className="input" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} required />
            </div>
            <div>
              <label className="label">Moneda *</label>
              <select className="select" value={form.moneda}
                onChange={e => {
                  const moneda = e.target.value as CurrencyCode;
                  setForm(f => ({ ...f, moneda, tasa_cambio: getLastTasaNC(moneda), aplicaciones: [] }));
                }}>
                {monedas.map(code => <option key={code} value={code}>{code} — {CURRENCIES[code].name}</option>)}
              </select>
            </div>
          </div>

          {form.moneda !== (config?.moneda_base ?? "ARS") && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex-wrap">
              <span className="text-sm text-amber-800 whitespace-nowrap">1 {form.moneda} =</span>
              <input
                type="number" step="0.01" min="0"
                className="input w-32 text-sm py-1"
                placeholder="Tasa"
                value={form.tasa_cambio || ""}
                onChange={e => {
                  const t = parseFloat(e.target.value) || 0;
                  setForm(f => ({ ...f, tasa_cambio: t }));
                  saveLastTasaNC(form.moneda, t);
                }}
              />
              <span className="text-sm text-amber-800 whitespace-nowrap">{config?.moneda_base ?? "ARS"}</span>
              <TasaCambioButton
                moneda={form.moneda}
                fecha={form.fecha}
                onChange={(v) => { setForm(f => ({ ...f, tasa_cambio: v })); saveLastTasaNC(form.moneda, v); }}
              />
            </div>
          )}

          {/* Concept lines */}
          <div className="border border-[var(--border)] rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-4 py-2.5 border-b border-[var(--border)]">
              <p className="font-medium text-sm">Concepto y monto *</p>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {form.lineas.map(l => (
                <div key={l.key} className="flex items-center gap-3 px-4 py-2.5">
                  <SearchableSelect
                    size="sm"
                    className="w-64"
                    value={l.concepto_id}
                    onChange={v => updateLinea(l.key, { concepto_id: v })}
                    options={conceptos.map(c => ({ value: c.id, label: c.nombre }))}
                    placeholder="— Concepto —"
                    emptyLabel="— Sin concepto —"
                  />
                  <input type="text" inputMode="decimal" className="input w-36 text-sm py-1" placeholder="0.00"
                    value={l.monto || ""}
                    onChange={e => updateLinea(l.key, { monto: parseMonto(e.target.value) })} />
                  <button type="button" className="text-[var(--muted)] hover:text-red-500 disabled:opacity-30"
                    onClick={() => removeLinea(l.key)} disabled={form.lineas.length === 1}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border)] bg-slate-50/50">
              <button type="button" className="text-sm text-[var(--primary)] hover:underline flex items-center gap-1 font-medium" onClick={addLinea}>
                <Plus className="w-3.5 h-3.5" /> Agregar línea
              </button>
              <span className="text-sm font-semibold">Total: {formatMoney(totalLineas, form.moneda, country.locale)}</span>
            </div>
          </div>

          {/* Applications */}
          {(form.aplicaciones.length > 0 || form.devolucion) && (
            <div className="border border-[var(--border)] rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-4 py-2.5 border-b border-[var(--border)]">
                <p className="font-medium text-sm">Asignación del crédito</p>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {form.aplicaciones.map(ap => {
                  const porPagar = ap.total_factura - ap.monto_pagado_antes;
                  return (
                    <div key={ap.key} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center px-4 py-2.5 text-sm">
                      <div>
                        <p className="font-medium">{ap.numero_factura ?? `#${ap.factura_id}`}</p>
                        <p className="text-xs text-[var(--muted)]">Por pagar: {formatMoney(porPagar, form.moneda, country.locale)}</p>
                      </div>
                      <div className="text-[var(--muted)] text-xs">Total: {formatMoney(ap.total_factura, form.moneda, country.locale)}</div>
                      <div className="text-[var(--muted)] text-xs">Pagado: {formatMoney(ap.monto_pagado_antes, form.moneda, country.locale)}</div>
                      <input type="text" inputMode="decimal" className="input w-32 text-sm py-1" placeholder="0.00"
                        value={ap.monto || ""}
                        onChange={e => updateAplicacion(ap.key, parseMonto(e.target.value))} />
                      <button type="button" className="text-[var(--muted)] hover:text-red-500" onClick={() => removeAplicacion(ap.key)}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
                {form.devolucion && (
                  <div className="px-4 py-3 text-sm space-y-2">
                    <div className="flex items-center gap-2 text-teal-700 font-medium mb-2">
                      <RotateCcw className="w-4 h-4" />
                      <span>Hay devolución de dinero</span>
                    </div>
                    <div className="grid grid-cols-[160px_1fr_130px_1fr_auto] gap-2 items-center">
                      <span className="text-xs text-[var(--muted)] font-medium">Fecha</span>
                      <span className="text-xs text-[var(--muted)] font-medium">Cuenta bancaria</span>
                      <span className="text-xs text-[var(--muted)] font-medium">Monto</span>
                      <span className="text-xs text-[var(--muted)] font-medium">Observaciones</span>
                      <span />
                    </div>
                    <div className="grid grid-cols-[160px_1fr_130px_1fr_auto] gap-2 items-center">
                      <input type="date" className="input text-sm py-1" value={form.devolucion.fecha}
                        onChange={e => setForm(f => ({ ...f, devolucion: f.devolucion ? { ...f.devolucion, fecha: e.target.value } : null }))} />
                      <select className="select text-sm py-1" value={form.devolucion.cuenta_id}
                        onChange={e => setForm(f => ({ ...f, devolucion: f.devolucion ? { ...f.devolucion, cuenta_id: e.target.value } : null }))}>
                        <option value="">— Cuenta bancaria —</option>
                        {(cuentas ?? []).filter(c => c.moneda === form.moneda).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                      <input type="text" inputMode="decimal" className="input text-sm py-1" placeholder="0.00"
                        value={form.devolucion.monto || ""}
                        onChange={e => setForm(f => ({ ...f, devolucion: f.devolucion ? { ...f.devolucion, monto: parseMonto(e.target.value) } : null }))} />
                      <input className="input text-sm py-1" placeholder="Observaciones"
                        value={form.devolucion.observaciones}
                        onChange={e => setForm(f => ({ ...f, devolucion: f.devolucion ? { ...f.devolucion, observaciones: e.target.value } : null }))} />
                      <button type="button" className="text-[var(--muted)] hover:text-red-500"
                        onClick={() => setForm(f => ({ ...f, devolucion: null }))}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 flex-wrap">
            {form.contacto_id !== "" && (
              <div className="relative">
                <button type="button"
                  className="text-sm text-[var(--primary)] hover:underline flex items-center gap-1 font-medium"
                  onClick={() => setShowPicker(v => !v)}>
                  <Plus className="w-3.5 h-3.5" /> Agregar factura de proveedor
                </button>
                {showPicker && facturasPendientes.length > 0 && (
                  <div className="absolute top-7 left-0 z-20 bg-white border border-[var(--border)] rounded-lg shadow-lg w-80 max-h-60 overflow-y-auto">
                    {facturasPendientes.map(f => (
                      <button key={f.id} type="button"
                        className="w-full text-left px-4 py-2.5 hover:bg-slate-50 text-sm border-b border-[var(--border)] last:border-0"
                        onClick={() => addFactura(f.id)}>
                        <span className="font-medium">{f.numero_factura ?? `#${f.id}`}</span>
                        <span className="text-[var(--muted)] ml-2">{formatMoney(Number(f.total) - Number(f.monto_pagado), f.moneda, country.locale)} por pagar</span>
                      </button>
                    ))}
                    {facturasPendientes.length === 0 && (
                      <p className="px-4 py-3 text-sm text-[var(--muted)]">No hay facturas pendientes</p>
                    )}
                  </div>
                )}
                {showPicker && facturasPendientes.length === 0 && (
                  <div className="absolute top-7 left-0 z-20 bg-white border border-[var(--border)] rounded-lg shadow-lg w-64 p-3 text-sm text-[var(--muted)]">
                    No hay facturas pendientes en {form.moneda}
                  </div>
                )}
              </div>
            )}
            {!form.devolucion && (
              <button type="button"
                className="text-sm text-teal-600 hover:underline flex items-center gap-1 font-medium"
                onClick={() => setForm(f => ({ ...f, devolucion: { fecha: f.fecha, cuenta_id: "", monto: 0, observaciones: "" } }))}>
                <RotateCcw className="w-3.5 h-3.5" /> Agregar devolución de dinero
              </button>
            )}
          </div>

          {/* Summary */}
          {totalLineas > 0 && (
            <div className="flex justify-end">
              <div className="space-y-1 text-sm w-72">
                {form.aplicaciones.map(ap => (
                  <div key={ap.key} className="flex justify-between">
                    <span className="text-[var(--muted)]">{ap.numero_factura ?? `#${ap.factura_id}`}</span>
                    <span>{formatMoney(ap.monto, form.moneda, country.locale)}</span>
                  </div>
                ))}
                {form.devolucion && montoDevolucion > 0 && (
                  <div className="flex justify-between text-teal-700">
                    <span>Devolución de dinero</span>
                    <span>{formatMoney(montoDevolucion, form.moneda, country.locale)}</span>
                  </div>
                )}
                {sinAsignar > 0.01 && (
                  <div className="flex justify-between text-amber-600">
                    <span>Sin asignar</span>
                    <span>{formatMoney(sinAsignar, form.moneda, country.locale)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1 border-t border-[var(--border)]">
                  <span className="font-semibold">Total nota</span>
                  <span className="font-bold text-base text-teal-600">{formatMoney(totalLineas, form.moneda, country.locale)}</span>
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="label">Notas</label>
            <textarea className="textarea" rows={2} value={form.notas_text}
              onChange={e => setForm(f => ({ ...f, notas_text: e.target.value }))} />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear nota"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
