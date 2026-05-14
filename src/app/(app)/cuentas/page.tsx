"use client";
import { useState, useEffect } from "react";
import { useTable, insertRow, updateRow, deleteRow, paisFilter } from "@/lib/useSupabaseData";
import type { Cuenta, CuentaTipo } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import { CURRENCIES, CurrencyCode, monedasDisponibles } from "@/lib/countries";
import { formatMoney } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import Link from "next/link";
import { Plus, Building2, Pencil, Trash2, Search, Loader2, ArrowRight } from "lucide-react";
import EntityMeta from "@/components/EntityMeta";

type FormState = {
  nombre: string;
  tipo: CuentaTipo;
  moneda: CurrencyCode;
  descripcion: string;
};

const TIPO_LABELS: Record<CuentaTipo, string> = {
  banco: "Banco",
  billetera: "Billetera virtual",
  efectivo: "Efectivo",
  otro: "Otro",
};
const TIPO_ICONS: Record<CuentaTipo, string> = {
  banco: "🏦",
  billetera: "💳",
  efectivo: "💵",
  otro: "🗂️",
};

export default function CuentasPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const monedas = pais ? monedasDisponibles(pais) : (["MXN"] as CurrencyCode[]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Cuenta | null>(null);
  const [form, setForm] = useState<FormState>({
    nombre: "",
    tipo: "banco",
    moneda: monedas[0],
    descripcion: "",
  });
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: cuentas, reload, loading } = useTable("cuentas", {
    orderBy: "nombre",
    ascending: true,
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });
  const { data: gastos } = useTable("gastos", {
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });
  const { data: ingresos } = useTable("ingresos", {
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });

  const filtered = (cuentas ?? []).filter((c) =>
    !search || c.nombre.toLowerCase().includes(search.toLowerCase())
  );

  /** Saldo estimado: ingresos - gastos de esa cuenta */
  function saldoCuenta(cuentaId: string, moneda: CurrencyCode): number {
    const entradas = (ingresos ?? [])
      .filter((i) => i.cuenta_id === cuentaId && i.moneda === moneda)
      .reduce((s, i) => s + Number(i.monto), 0);
    const salidas = (gastos ?? [])
      .filter((g) => g.cuenta_id === cuentaId && g.moneda === moneda)
      .reduce((s, g) => s + Number(g.total), 0);
    return entradas - salidas;
  }

  function openNew() {
    setEditing(null);
    setForm({ nombre: "", tipo: "banco", moneda: monedas[0], descripcion: "" });
    setOpen(true);
  }

  // Atajo N
  useEffect(() => {
    const handler = () => openNew();
    window.addEventListener("app:new", handler);
    return () => window.removeEventListener("app:new", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monedas]);

  function openEdit(c: Cuenta) {
    setEditing(c);
    setForm({
      nombre: c.nombre,
      tipo: c.tipo,
      moneda: c.moneda,
      descripcion: c.descripcion ?? "",
    });
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nombre.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ctx_pais: pais,
        nombre: form.nombre.trim(),
        tipo: form.tipo,
        moneda: form.moneda,
        descripcion: form.descripcion || null,
      };
      if (editing) {
        await updateRow("cuentas", editing.id, payload);
      } else {
        await insertRow("cuentas", payload);
      }
      await reload();
      setOpen(false);
    } catch (err) {
      alert("Error: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Cuenta) {
    const movimientos = [
      ...(ingresos ?? []).filter((i) => i.cuenta_id === c.id),
      ...(gastos ?? []).filter((g) => g.cuenta_id === c.id),
    ];
    if (movimientos.length > 0) {
      alert(`No se puede eliminar "${c.nombre}" porque tiene ${movimientos.length} movimiento${movimientos.length !== 1 ? "s" : ""} asociado${movimientos.length !== 1 ? "s" : ""}.`);
      return;
    }
    if (!confirm(`¿Eliminar la cuenta "${c.nombre}"?`)) return;
    try {
      await deleteRow("cuentas", c.id);
      await reload();
    } catch (err) {
      alert("Error: " + (err as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Cuentas"
        description="Bancos, billeteras virtuales y efectivo"
        action={
          <button className="btn btn-primary" onClick={openNew}>
            <Plus className="w-4 h-4" /> Nueva cuenta
          </button>
        }
      />

      {(cuentas ?? []).length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {(cuentas ?? []).map((c) => {
            const saldo = saldoCuenta(c.id, c.moneda);
            return (
              <Link
                key={c.id}
                href={`/cuentas/${c.id}`}
                className="card group hover:border-[var(--primary)] hover:shadow-md transition-all cursor-pointer"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-2xl">{TIPO_ICONS[c.tipo]}</span>
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{c.nombre}</p>
                      <p className="text-xs text-[var(--muted)]">{TIPO_LABELS[c.tipo]} · {c.moneda}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </div>
                <p className="text-xs text-[var(--muted)] mb-1">Saldo estimado</p>
                <p className={`text-xl font-semibold ${saldo >= 0 ? "text-emerald-400" : "text-red-500"}`}>
                  {formatMoney(saldo, c.moneda, country.locale)}
                </p>
              </Link>
            );
          })}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h3 className="font-semibold">Listado de cuentas</h3>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input pl-9 w-56"
              placeholder="Buscar cuenta…"
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
            icon={<Building2 className="w-6 h-6" />}
            title={cuentas?.length ? "Sin resultados" : "Aún no hay cuentas"}
            description="Creá cuentas para registrar en qué banco o billetera se acreditan tus cobros y pagos."
            action={
              !cuentas?.length && (
                <button className="btn btn-primary" onClick={openNew}>
                  <Plus className="w-4 h-4" /> Nueva cuenta
                </button>
              )
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Tipo</th>
                <th>Moneda</th>
                <th>Descripción</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">
                    <span className="mr-2">{TIPO_ICONS[c.tipo]}</span>
                    {c.nombre}
                  </td>
                  <td className="text-[var(--muted)]">{TIPO_LABELS[c.tipo]}</td>
                  <td className="text-[var(--muted)]">{c.moneda}</td>
                  <td className="text-[var(--muted)] max-w-xs truncate">{c.descripcion || "—"}</td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn btn-ghost p-1.5" onClick={() => openEdit(c)}>
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button className="btn btn-ghost p-1.5 text-red-600" onClick={() => remove(c)}>
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
        title={editing ? "Editar cuenta" : "Nueva cuenta"}
      >
        <form onSubmit={save} className="space-y-4">
          {editing && (
            <EntityMeta entity="cuentas" entityId={editing.id} variant="block" />
          )}
          <div>
            <label className="label">Nombre *</label>
            <input
              className="input"
              placeholder="Ej: Mercado Pago, Galicia, Efectivo…"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Tipo *</label>
              <select
                className="select"
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value as CuentaTipo })}
              >
                <option value="banco">🏦 Banco</option>
                <option value="billetera">💳 Billetera virtual</option>
                <option value="efectivo">💵 Efectivo</option>
                <option value="otro">🗂️ Otro</option>
              </select>
            </div>
            <div>
              <label className="label">Moneda *</label>
              <select
                className="select"
                value={form.moneda}
                onChange={(e) => setForm({ ...form, moneda: e.target.value as CurrencyCode })}
              >
                {monedas.map((code) => (
                  <option key={code} value={code}>
                    {code} — {CURRENCIES[code].name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Descripción</label>
            <textarea
              className="textarea"
              placeholder="Descripción opcional…"
              value={form.descripcion}
              onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear cuenta"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
