"use client";
import { useState, useEffect } from "react";
import { useTable, insertRow, updateRow, deleteRow, paisFilter } from "@/lib/useSupabaseData";
import { createClient } from "@/lib/supabase/client";
import type { Concepto } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { Plus, Layers, Pencil, Trash2, Search, Loader2, ArrowUpRight } from "lucide-react";
import EntityMeta from "@/components/EntityMeta";

type FormState = {
  nombre: string;
  descripcion: string;
  es_anticipo: boolean;
};

const BLANK: FormState = { nombre: "", descripcion: "", es_anticipo: false };

export default function ConceptosPage() {
  const { config } = useConfig();
  const pais = config?.pais;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Concepto | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: conceptos, reload, loading } = useTable("conceptos", {
    orderBy: "nombre",
    ascending: true,
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });

  const filtered = (conceptos ?? []).filter((c) =>
    !search || c.nombre.toLowerCase().includes(search.toLowerCase())
  );

  function openNew() {
    setEditing(null);
    setForm(BLANK);
    setOpen(true);
  }

  // Atajo de teclado N: abrir modal de nuevo
  useEffect(() => {
    const handler = () => openNew();
    window.addEventListener("app:new", handler);
    return () => window.removeEventListener("app:new", handler);
  }, []);

  function openEdit(c: Concepto) {
    setEditing(c);
    setForm({
      nombre: c.nombre,
      descripcion: c.descripcion ?? "",
      es_anticipo: !!c.es_anticipo,
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
        tipo: "ambos" as const,
        descripcion: form.descripcion || null,
        es_anticipo: form.es_anticipo,
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
    try {
      const supabase = createClient();
      const [{ count: ci }, { count: cg }] = await Promise.all([
        supabase.from("ingresos").select("id", { count: "exact", head: true }).eq("concepto_id", c.id),
        supabase.from("gastos").select("id", { count: "exact", head: true }).eq("concepto_id", c.id),
      ]);
      const total = (ci ?? 0) + (cg ?? 0);
      if (total > 0) {
        alert(`No se puede eliminar "${c.nombre}" porque está en uso en ${total} registro${total !== 1 ? "s" : ""}.`);
        return;
      }
    } catch (err) {
      alert("Error al verificar: " + (err as Error).message);
      return;
    }
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
        description="Categorías para clasificar ingresos y egresos"
        action={
          <button className="btn btn-primary" onClick={openNew}>
            <Plus className="w-4 h-4" /> Nuevo concepto
          </button>
        }
      />

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex justify-end">
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

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--muted)]" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Layers className="w-6 h-6" />}
            title={conceptos?.length ? "Sin resultados" : "Aún no hay conceptos"}
            description="Creá conceptos para clasificar tus facturas, pagos e ingresos."
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
                <th>Descripción</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      {c.nombre}
                      {c.es_anticipo && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                          <ArrowUpRight className="w-3 h-3" />
                          Anticipo
                        </span>
                      )}
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

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Editar concepto" : "Nuevo concepto"}>
        <form onSubmit={save} className="space-y-4">
          {editing && (
            <EntityMeta entity="conceptos" entityId={editing.id} variant="block" />
          )}
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
            <label className="label">Descripción</label>
            <textarea
              className="textarea"
              placeholder="Descripción opcional…"
              value={form.descripcion}
              onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
            />
          </div>
          <label className="flex items-start gap-3 p-3 border border-[var(--border)] rounded-lg cursor-pointer hover:bg-slate-50">
            <input
              type="checkbox"
              checked={form.es_anticipo}
              onChange={(e) => setForm({ ...form, es_anticipo: e.target.checked })}
              className="mt-0.5"
            />
            <div className="flex-1">
              <p className="font-medium text-sm flex items-center gap-2">
                Es un anticipo a proveedor
                <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                  Anticipo
                </span>
              </p>
              <p className="text-xs text-[var(--muted)] mt-1">
                Los pagos hechos con este concepto van a tratarse como <strong>anticipos</strong> y van a aparecer en la pantalla del contacto del proveedor para que puedas aplicarlos a facturas futuras.
              </p>
            </div>
          </label>
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
