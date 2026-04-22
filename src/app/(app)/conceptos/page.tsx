"use client";
import { useState } from "react";
import { useTable, insertRow, updateRow, deleteRow, paisFilter } from "@/lib/useSupabaseData";
import type { Concepto, ConceptoTipo } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import { formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { Plus, Layers, Pencil, Trash2, Search } from "lucide-react";

type FormState = {
  nombre: string;
  tipo: ConceptoTipo;
  descripcion: string;
};

const BLANK: FormState = { nombre: "", tipo: "ambos", descripcion: "" };

const TIPO_LABELS: Record<ConceptoTipo, string> = {
  ingreso: "Ingreso",
  egreso: "Egreso",
  ambos: "Ambos",
};
const TIPO_BADGE: Record<ConceptoTipo, string> = {
  ingreso: "badge-success",
  egreso: "badge-danger",
  ambos: "badge-info",
};

export default function ConceptosPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Concepto | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);
  const [search, setSearch] = useState("");
  const [filterTipo, setFilterTipo] = useState<"todos" | ConceptoTipo>("todos");
  const [saving, setSaving] = useState(false);

  const { data: conceptos, reload } = useTable("conceptos", {
    orderBy: "nombre",
    ascending: true,
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });

  const filtered = (conceptos ?? []).filter((c) => {
    if (filterTipo !== "todos" && c.tipo !== filterTipo) return false;
    if (!search) return true;
    return c.nombre.toLowerCase().includes(search.toLowerCase());
  });

  function openNew() {
    setEditing(null);
    setForm(BLANK);
    setOpen(true);
  }

  function openEdit(c: Concepto) {
    setEditing(c);
    setForm({ nombre: c.nombre, tipo: c.tipo, descripcion: c.descripcion ?? "" });
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
        descripcion: form.descripcion || null,
      };
      if (editing) {
        await updateRow("conceptos", editing.id, payload);
      } else {
        await insertRow("conceptos", payload);
      }
      await reload();
      setOpen(false);
    } catch (err) {
      alert("Error: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Concepto) {
    if (!confirm(`¿Eliminar el concepto "${c.nombre}"?`)) return;
    try {
      await deleteRow("conceptos", c.id);
      await reload();
    } catch (err) {
      alert("Error: " + (err as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Conceptos"
        description="Categorías personalizadas para clasificar ingresos y egresos"
        action={
          <button className="btn btn-primary" onClick={openNew}>
            <Plus className="w-4 h-4" /> Nuevo concepto
          </button>
        }
      />

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="flex gap-1">
            {(["todos", "ingreso", "egreso", "ambos"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilterTipo(f)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filterTipo === f
                    ? "bg-[var(--primary-soft)] text-[var(--primary-hover)]"
                    : "text-[var(--muted)] hover:bg-slate-100"
                }`}
              >
                {f === "todos" ? "Todos" : TIPO_LABELS[f]}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input pl-9 sm:w-64"
              placeholder="Buscar concepto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<Layers className="w-6 h-6" />}
            title={conceptos?.length ? "Sin resultados" : "Aún no hay conceptos"}
            description="Creá conceptos para clasificar tus facturas, pagos e ingresos en lugar de categorías fijas."
            action={
              !conceptos?.length && (
                <button className="btn btn-primary" onClick={openNew}>
                  <Plus className="w-4 h-4" /> Nuevo concepto
                </button>
              )
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Aplica a</th>
                <th>Descripción</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.nombre}</td>
                  <td>
                    <span className={`badge ${TIPO_BADGE[c.tipo]}`}>
                      {TIPO_LABELS[c.tipo]}
                    </span>
                  </td>
                  <td className="text-[var(--muted)] max-w-xs truncate">
                    {c.descripcion || "—"}
                  </td>
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
        title={editing ? "Editar concepto" : "Nuevo concepto"}
      >
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="label">Nombre *</label>
            <input
              className="input"
              placeholder="Ej: Alquiler, Sueldos, Ventas…"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Aplica a *</label>
            <select
              className="select"
              value={form.tipo}
              onChange={(e) => setForm({ ...form, tipo: e.target.value as ConceptoTipo })}
            >
              <option value="ambos">Ambos (ingresos y egresos)</option>
              <option value="ingreso">Solo ingresos</option>
              <option value="egreso">Solo egresos</option>
            </select>
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
              {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear concepto"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
