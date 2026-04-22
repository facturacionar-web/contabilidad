"use client";
import { useState } from "react";
import { useTable, insertRow, updateRow, deleteRow } from "@/lib/useSupabaseData";
import type { Contacto, ContactoTipo } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import { COUNTRIES, CountryCode } from "@/lib/countries";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { Plus, Users, Pencil, Trash2, Search } from "lucide-react";

type FormState = {
  tipo: ContactoTipo;
  nombre: string;
  tax_id: string;
  email: string;
  telefono: string;
  direccion: string;
  pais: CountryCode | "";
  notas: string;
};

const BLANK: FormState = {
  tipo: "cliente",
  nombre: "",
  tax_id: "",
  email: "",
  telefono: "",
  direccion: "",
  pais: "",
  notas: "",
};

export default function ContactosPage() {
  const { country } = useConfig();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Contacto | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"todos" | ContactoTipo>("todos");
  const [saving, setSaving] = useState(false);

  const { data: contactos, reload } = useTable("contactos", {
    orderBy: "nombre",
    ascending: true,
  });

  const filtered = (contactos ?? []).filter((c) => {
    if (filter !== "todos") {
      if (filter === "ambos") {
        if (c.tipo !== "ambos") return false;
      } else {
        if (c.tipo !== filter && c.tipo !== "ambos") return false;
      }
    }
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.nombre.toLowerCase().includes(q) ||
      (c.tax_id?.toLowerCase() ?? "").includes(q) ||
      (c.email?.toLowerCase() ?? "").includes(q)
    );
  });

  function openNew() {
    setEditing(null);
    setForm({ ...BLANK, pais: country.code });
    setOpen(true);
  }

  function openEdit(c: Contacto) {
    setEditing(c);
    setForm({
      tipo: c.tipo,
      nombre: c.nombre,
      tax_id: c.tax_id ?? "",
      email: c.email ?? "",
      telefono: c.telefono ?? "",
      direccion: c.direccion ?? "",
      pais: c.pais ?? "",
      notas: c.notas ?? "",
    });
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nombre.trim()) return;
    setSaving(true);
    try {
      const payload = {
        tipo: form.tipo,
        nombre: form.nombre,
        tax_id: form.tax_id || null,
        email: form.email || null,
        telefono: form.telefono || null,
        direccion: form.direccion || null,
        pais: (form.pais || null) as CountryCode | null,
        notas: form.notas || null,
      };
      if (editing) {
        await updateRow("contactos", editing.id, payload);
      } else {
        await insertRow("contactos", payload);
      }
      await reload();
      setOpen(false);
    } catch (err) {
      alert("Error: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Contacto) {
    if (!confirm(`¿Eliminar a ${c.nombre}?`)) return;
    try {
      await deleteRow("contactos", c.id);
      await reload();
    } catch (err) {
      alert("Error: " + (err as Error).message);
    }
  }

  const badge = (tipo: ContactoTipo) => {
    const map: Record<ContactoTipo, string> = {
      cliente: "badge-info",
      proveedor: "badge-warning",
      ambos: "badge-success",
    };
    const label: Record<ContactoTipo, string> = {
      cliente: "Cliente",
      proveedor: "Proveedor",
      ambos: "Ambos",
    };
    return <span className={`badge ${map[tipo]}`}>{label[tipo]}</span>;
  };

  return (
    <>
      <PageHeader
        title="Contactos"
        description="Clientes y proveedores"
        action={
          <button className="btn btn-primary" onClick={openNew}>
            <Plus className="w-4 h-4" /> Nuevo contacto
          </button>
        }
      />

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="flex gap-1">
            {(["todos", "cliente", "proveedor", "ambos"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filter === f
                    ? "bg-[var(--primary-soft)] text-[var(--primary-hover)]"
                    : "text-[var(--muted)] hover:bg-slate-100"
                }`}
              >
                {f === "todos" ? "Todos" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input pl-9 sm:w-72"
              placeholder="Buscar por nombre, ID o email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<Users className="w-6 h-6" />}
            title={contactos?.length ? "Sin resultados" : "Aún no hay contactos"}
            description={
              contactos?.length
                ? "Prueba cambiar los filtros o la búsqueda."
                : "Registra clientes y proveedores para asociarlos a ingresos y gastos."
            }
            action={
              !contactos?.length && (
                <button className="btn btn-primary" onClick={openNew}>
                  <Plus className="w-4 h-4" /> Nuevo contacto
                </button>
              )
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Identificación</th>
                <th>Contacto</th>
                <th>País</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.nombre}</td>
                  <td>{badge(c.tipo)}</td>
                  <td className="text-[var(--muted)]">{c.tax_id || "—"}</td>
                  <td className="text-[var(--muted)]">
                    {c.email || c.telefono || "—"}
                  </td>
                  <td>{c.pais ? `${COUNTRIES[c.pais].flag} ${c.pais}` : "—"}</td>
                  <td className="text-right">
                    <button className="btn btn-ghost p-1.5" onClick={() => openEdit(c)} title="Editar">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button className="btn btn-ghost p-1.5 text-red-600" onClick={() => remove(c)} title="Eliminar">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Editar contacto" : "Nuevo contacto"}>
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Tipo *</label>
              <select
                className="select"
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value as ContactoTipo })}
              >
                <option value="cliente">Cliente</option>
                <option value="proveedor">Proveedor</option>
                <option value="ambos">Ambos</option>
              </select>
            </div>
            <div>
              <label className="label">País</label>
              <select
                className="select"
                value={form.pais}
                onChange={(e) => setForm({ ...form, pais: e.target.value as CountryCode | "" })}
              >
                <option value="">—</option>
                {Object.values(COUNTRIES).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Nombre / Razón social *</label>
            <input
              className="input"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">
                {form.pais ? COUNTRIES[form.pais].taxIdLabel : "Identificación"}
              </label>
              <input
                className="input"
                placeholder={form.pais ? COUNTRIES[form.pais].taxIdPlaceholder : ""}
                value={form.tax_id}
                onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Teléfono</label>
              <input
                className="input"
                value={form.telefono}
                onChange={(e) => setForm({ ...form, telefono: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Dirección</label>
            <input
              className="input"
              value={form.direccion}
              onChange={(e) => setForm({ ...form, direccion: e.target.value })}
            />
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
              {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear contacto"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
