"use client";
import { useState } from "react";
import { useTable, insertRow, updateRow, deleteRow, paisFilter } from "@/lib/useSupabaseData";
import type { NotaCredito, GastoEstado } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { useConfig } from "@/lib/useConfig";
import { CURRENCIES, CurrencyCode, monedasDisponibles } from "@/lib/countries";
import { formatMoney, formatDate, todayISO } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import Link from "next/link";
import { Plus, FileMinus, Pencil, Trash2, Search } from "lucide-react";

type FormState = {
  fecha: string;
  contacto_id: number | "";
  numero: string;
  gasto_relacionado_id: number | "";
  concepto_id: string;
  monto: number;
  moneda: CurrencyCode;
  notas: string;
};

function blank(moneda: CurrencyCode): FormState {
  return {
    fecha: todayISO(),
    contacto_id: "",
    numero: "",
    gasto_relacionado_id: "",
    concepto_id: "",
    monto: 0,
    moneda,
    notas: "",
  };
}

export default function NotasCreditoPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const monedas = pais ? monedasDisponibles(pais) : (["MXN"] as CurrencyCode[]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NotaCredito | null>(null);
  const [form, setForm] = useState<FormState>(blank("MXN"));
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: notas, reload } = useTable("notas_credito", {
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

  const proveedores = (contactos ?? []).filter(c => c.tipo === "proveedor" || c.tipo === "ambos");
  const conceptos = (conceptosAll ?? []).filter(c => c.tipo === "egreso" || c.tipo === "ambos");
  const facturas = (gastos ?? []).filter(g => g.tipo === "factura_proveedor" && g.estado !== "pagado");

  const filtered = (notas ?? []).filter((n) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      n.concepto.toLowerCase().includes(q) ||
      (n.numero?.toLowerCase() ?? "").includes(q)
    );
  });

  const contactoName = (id?: number | null) =>
    contactos?.find((c) => c.id === id)?.nombre ?? "—";

  function openNew() {
    setEditing(null);
    setForm(blank(monedas[0]));
    setOpen(true);
  }

  function openEdit(n: NotaCredito) {
    setEditing(n);
    setForm({
      fecha: n.fecha,
      contacto_id: n.contacto_id ?? "",
      numero: n.numero ?? "",
      gasto_relacionado_id: n.gasto_relacionado_id ?? "",
      concepto_id: "",
      monto: Number(n.monto),
      moneda: n.moneda,
      notas: n.notas ?? "",
    });
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.concepto_id || form.monto <= 0) {
      alert("El concepto y el monto son obligatorios.");
      return;
    }
    setSaving(true);
    try {
      const conceptoNombre = conceptos.find(c => c.id === form.concepto_id)?.nombre ?? "";
      const payload = {
        ctx_pais: pais,
        fecha: form.fecha,
        tipo: "recibida" as const,
        contacto_id: form.contacto_id === "" ? null : Number(form.contacto_id),
        numero: form.numero || null,
        gasto_relacionado_id: form.gasto_relacionado_id === "" ? null : Number(form.gasto_relacionado_id),
        concepto: conceptoNombre,
        monto: form.monto,
        moneda: form.moneda,
        motivo: "",
        notas: form.notas || null,
      };
      const supabase = createClient();

      // Si estamos editando y tenía factura vinculada, revertir el crédito anterior
      if (editing?.gasto_relacionado_id) {
        const { data: fac } = await supabase.from("gastos").select("*").eq("id", editing.gasto_relacionado_id).single();
        if (fac) {
          const revertido = Math.max(0, Math.round((Number(fac.monto_pagado) - Number(editing.monto)) * 100) / 100);
          const total = Math.round(Number(fac.total) * 100) / 100;
          const estado: GastoEstado = revertido <= 0 ? "pendiente" : revertido >= total ? "pagado" : "parcial";
          await updateRow("gastos", editing.gasto_relacionado_id, { monto_pagado: revertido, estado });
        }
      }

      if (editing) {
        await updateRow("notas_credito", editing.id, payload);
      } else {
        await insertRow("notas_credito", payload);
      }

      // Aplicar el crédito a la factura vinculada
      if (payload.gasto_relacionado_id) {
        const { data: fac } = await supabase.from("gastos").select("*").eq("id", payload.gasto_relacionado_id).single();
        if (fac) {
          const nuevo_pagado = Math.min(
            Math.round((Number(fac.monto_pagado) + form.monto) * 100) / 100,
            Math.round(Number(fac.total) * 100) / 100
          );
          const total = Math.round(Number(fac.total) * 100) / 100;
          const estado: GastoEstado = nuevo_pagado >= total ? "pagado" : nuevo_pagado > 0 ? "parcial" : "pendiente";
          await updateRow("gastos", payload.gasto_relacionado_id, { monto_pagado: nuevo_pagado, estado });
        }
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
      if (n.gasto_relacionado_id) {
        const supabase = createClient();
        const { data: fac } = await supabase.from("gastos").select("*").eq("id", n.gasto_relacionado_id).single();
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
        action={
          <button className="btn btn-primary" onClick={openNew}>
            <Plus className="w-4 h-4" /> Nueva nota
          </button>
        }
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
            <input
              className="input pl-9 sm:w-72"
              placeholder="Buscar por concepto o número…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<FileMinus className="w-6 h-6" />}
            title={notas?.length ? "Sin resultados" : "Aún no hay notas de crédito"}
            description="Registrá notas de crédito recibidas de proveedores."
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
                <th>Número</th>
                <th>Concepto</th>
                <th>Proveedor</th>
                <th>Factura relacionada</th>
                <th className="text-right">Monto</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((n) => {
                const facturaRel = facturas.find(g => g.id === n.gasto_relacionado_id);
                return (
                  <tr key={n.id}>
                    <td className="whitespace-nowrap">{formatDate(n.fecha, country.locale)}</td>
                    <td className="text-[var(--muted)]">{n.numero || "—"}</td>
                    <td className="font-medium max-w-xs truncate">{n.concepto}</td>
                    <td className="text-[var(--muted)]">
                      {n.contacto_id
                        ? <Link href={`/contactos/${n.contacto_id}`} className="hover:underline hover:text-[var(--primary)]">{contactoName(n.contacto_id)}</Link>
                        : "—"}
                    </td>
                    <td className="text-[var(--muted)]">
                      {facturaRel ? `${facturaRel.numero_factura ?? `#${facturaRel.id}`} — ${formatMoney(Number(facturaRel.total), facturaRel.moneda, country.locale)}` : "—"}
                    </td>
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
                );
              })}
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <select
              className="select"
              value={form.concepto_id}
              onChange={(e) => setForm({ ...form, concepto_id: e.target.value })}
              required
            >
              <option value="">— Seleccionar concepto —</option>
              {conceptos.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Proveedor</label>
              <select
                className="select"
                value={form.contacto_id}
                onChange={(e) =>
                  setForm({ ...form, contacto_id: e.target.value === "" ? "" : Number(e.target.value), gasto_relacionado_id: "" })
                }
              >
                <option value="">— Sin proveedor —</option>
                {proveedores.map((c) => (
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
                  setForm({ ...form, gasto_relacionado_id: e.target.value === "" ? "" : Number(e.target.value) })
                }
              >
                <option value="">— Ninguna —</option>
                {facturas
                  .filter(g => form.contacto_id === "" || g.contacto_id === Number(form.contacto_id))
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.numero_factura ?? `#${g.id}`} — {formatMoney(Number(g.total), g.moneda, country.locale)}{g.fecha_vencimiento ? ` — vence ${formatDate(g.fecha_vencimiento, country.locale)}` : ""}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                {monedas.map((code) => (
                  <option key={code} value={code}>{code} — {CURRENCIES[code].name}</option>
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
