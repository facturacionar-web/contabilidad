"use client";
import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTable, insertRow, updateRow, deleteRow, paisFilter } from "@/lib/useSupabaseData";
import { createClient } from "@/lib/supabase/client";
import type { Ingreso } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import { CURRENCIES, CurrencyCode, PAYMENT_METHODS, monedasDisponibles } from "@/lib/countries";
import { formatMoney, formatDate, todayISO } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { Plus, TrendingUp, Pencil, Trash2, Search, Loader2 } from "lucide-react";
import Link from "next/link";
import SearchableSelect from "@/components/SearchableSelect";
import EntityMeta from "@/components/EntityMeta";
import TasaCambioButton from "@/components/TasaCambioButton";

type FormState = {
  fecha: string;
  contacto_id: number | "";
  concepto: string;
  concepto_id: string;
  cuenta_id: string;
  monto: number;
  moneda: CurrencyCode;
  tasa_cambio: number;
  metodo_pago: string;
  referencia: string;
  notas: string;
};

function getLastTasa(moneda: string): number {
  if (typeof window === "undefined") return 1;
  const stored = localStorage.getItem(`last_tasa_${moneda}`);
  return stored ? parseFloat(stored) || 1 : 1;
}
function saveLastTasa(moneda: string, tasa: number): void {
  if (typeof window === "undefined" || tasa <= 0) return;
  localStorage.setItem(`last_tasa_${moneda}`, String(tasa));
}

function blank(moneda: CurrencyCode): FormState {
  return {
    fecha: todayISO(),
    contacto_id: "",
    concepto: "",
    concepto_id: "",
    cuenta_id: "",
    monto: 0,
    moneda,
    tasa_cambio: getLastTasa(moneda),
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
  const [conciliarId, setConciliarId] = useState<number | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const autoOpenedRef = useRef(false);

  const { data: ingresos, reload, loading } = useTable("ingresos", {
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

  // Atajo N
  useEffect(() => {
    const handler = () => openNew();
    window.addEventListener("app:new", handler);
    return () => window.removeEventListener("app:new", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monedas]);

  // Auto-abrir modal con datos de Conciliación o ?nuevo=1
  useEffect(() => {
    if (autoOpenedRef.current || !pais || searchParams.get("nuevo") !== "1") return;
    const fecha = searchParams.get("fecha");
    const cuenta = searchParams.get("cuenta");
    const monto = searchParams.get("monto");
    const conciliar = searchParams.get("conciliar");
    autoOpenedRef.current = true;
    openNew();
    if (fecha || cuenta || monto) {
      setForm(f => ({
        ...f,
        ...(fecha ? { fecha } : {}),
        ...(cuenta ? { cuenta_id: cuenta } : {}),
        ...(monto ? { monto: Number(monto) } : {}),
      }));
    }
    if (conciliar) setConciliarId(Number(conciliar));
    const params = new URLSearchParams(searchParams.toString());
    params.delete("nuevo"); params.delete("fecha"); params.delete("cuenta");
    params.delete("monto"); params.delete("conciliar");
    const qs = params.toString();
    router.replace(qs ? `/ingresos/pagos-recibidos?${qs}` : "/ingresos/pagos-recibidos");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pais, searchParams]);

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
      tasa_cambio: Number(i.tasa_cambio ?? 1),
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
        tasa_cambio: form.tasa_cambio || 1,
        metodo_pago: form.metodo_pago,
        referencia: form.referencia || null,
        notas: form.notas || null,
      };
      saveLastTasa(form.moneda, form.tasa_cambio);
      let ingresoId: number;
      if (editing) {
        await updateRow("ingresos", editing.id, payload);
        ingresoId = editing.id;
      } else {
        const inserted = await insertRow("ingresos", payload);
        ingresoId = inserted.id;
      }
      // Si vino desde Conciliación, vincular este ingreso al movimiento del banco
      const cameFromConciliacion = conciliarId != null && !editing;
      if (conciliarId && !editing) {
        try {
          const sb = createClient();
          await sb.from("conciliacion_movimientos").update({
            matched_type: "ingreso",
            matched_id: ingresoId,
            matched_by: "created",
            matched_score: 100,
            estado: "conciliado",
            reconciled_at: new Date().toISOString(),
          } as never).eq("id", conciliarId);
        } catch (e) {
          console.warn("[conciliacion] no se pudo vincular:", e);
        }
        setConciliarId(null);
      }
      await reload();
      setOpen(false);
      if (cameFromConciliacion) router.push("/conciliacion");
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

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--muted)]" />
          </div>
        ) : filtered.length === 0 ? (
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
          {editing && (
            <EntityMeta entity="ingresos" entityId={editing.id} variant="block" />
          )}
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
              <SearchableSelect
                value={form.concepto_id}
                onChange={v => setForm({ ...form, concepto_id: v })}
                options={conceptos.map(c => ({ value: c.id, label: c.nombre }))}
                placeholder="— Sin concepto —"
                emptyLabel="— Sin concepto —"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Cliente</label>
              <SearchableSelect
                value={form.contacto_id}
                onChange={v => setForm({ ...form, contacto_id: v === "" ? "" : Number(v) })}
                options={(contactos ?? []).filter(c => c.tipo === "cliente" || c.tipo === "ambos").map(c => ({ value: c.id, label: c.nombre }))}
                placeholder="— Sin cliente —"
                emptyLabel="— Sin cliente —"
              />
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
              <select className="select" value={form.moneda} onChange={(e) => {
                const moneda = e.target.value as CurrencyCode;
                setForm({ ...form, moneda, tasa_cambio: getLastTasa(moneda) });
              }}>
                {monedas.map((code) => (
                  <option key={code} value={code}>{code} — {CURRENCIES[code].name}</option>
                ))}
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
                onChange={e => setForm({ ...form, tasa_cambio: parseFloat(e.target.value) || 0 })}
              />
              <span className="text-sm text-amber-800 whitespace-nowrap">{config?.moneda_base ?? "ARS"}</span>
              <TasaCambioButton
                moneda={form.moneda}
                fecha={form.fecha}
                onChange={(v) => setForm(f => ({ ...f, tasa_cambio: v }))}
              />
            </div>
          )}

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
