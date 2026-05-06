"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTable, insertRow, updateRow, deleteRow, paisFilter } from "@/lib/useSupabaseData";
import { createClient } from "@/lib/supabase/client";
import type { Contacto, ContactoTipo } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { Plus, Users, Pencil, Trash2, Search, Loader2 } from "lucide-react";
import { useSortable } from "@/lib/useSortable";
import SortHeader from "@/components/SortHeader";
import { usePagination } from "@/lib/usePagination";
import Pagination from "@/components/Pagination";
import EntityMeta from "@/components/EntityMeta";

type FormState = {
  tipo: ContactoTipo;
  nombre: string;
  tax_id: string;
  email: string;
  telefono: string;
  direccion: string;
  notas: string;
};

const BLANK: FormState = {
  tipo: "cliente",
  nombre: "",
  tax_id: "",
  email: "",
  telefono: "",
  direccion: "",
  notas: "",
};

export default function ContactosPage() {
  const router = useRouter();
  const { config } = useConfig();
  const pais = config?.pais;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Contacto | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"todos" | ContactoTipo>("todos");
  const [saving, setSaving] = useState(false);
  const [cuitLoading, setCuitLoading] = useState(false);

  const { data: contactos, reload, loading } = useTable("contactos", {
    orderBy: "nombre",
    ascending: true,
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });

  const filteredRaw = (contactos ?? []).filter((c) => {
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

  const { sortBy, sortDir, toggleSort, sorted } = useSortable(filteredRaw, {
    getValue: (c, key) => {
      switch (key) {
        case "nombre": return c.nombre;
        case "tipo": return c.tipo;
        case "tax_id": return c.tax_id ?? "";
        default: return "";
      }
    },
    initial: { key: "nombre", dir: "asc" },
  });
  const filtered = sorted ?? filteredRaw;

  const pagination = usePagination(filtered, "contactos", 50);
  const pageRows = pagination.pageRows;

  function openNew() {
    setEditing(null);
    setForm(BLANK);
    setOpen(true);
  }

  // Atajo N
  useEffect(() => {
    const handler = () => openNew();
    window.addEventListener("app:new", handler);
    return () => window.removeEventListener("app:new", handler);
  }, []);

  function openEdit(c: Contacto) {
    setEditing(c);
    setForm({
      tipo: c.tipo,
      nombre: c.nombre,
      tax_id: c.tax_id ?? "",
      email: c.email ?? "",
      telefono: c.telefono ?? "",
      direccion: c.direccion ?? "",
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
        ctx_pais: pais,
        tipo: form.tipo,
        nombre: form.nombre,
        tax_id: form.tax_id || null,
        email: form.email || null,
        telefono: form.telefono || null,
        direccion: form.direccion || null,
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

  async function buscarCuit() {
    const cuit = form.tax_id.replace(/\D/g, "");
    if (cuit.length < 10) return;
    setCuitLoading(true);
    try {
      const res = await fetch(`/api/cuit?cuit=${cuit}`);
      const data = await res.json();
      if (data.razon_social) {
        setForm((f) => ({ ...f, nombre: data.razon_social }));
      } else {
        alert(`CUIT no encontrado: ${data.error ?? "sin resultado"}`);
      }
    } catch (err) {
      alert("Error: " + (err as Error).message);
    } finally {
      setCuitLoading(false);
    }
  }

  async function remove(c: Contacto) {
    // Verificar que no tenga registros asociados antes de borrar
    try {
      const supabase = createClient();
      const [{ count: ci }, { count: cg }, { count: cn }] = await Promise.all([
        supabase.from("ingresos").select("id", { count: "exact", head: true }).eq("contacto_id", c.id),
        supabase.from("gastos").select("id", { count: "exact", head: true }).eq("contacto_id", c.id),
        supabase.from("notas_credito").select("id", { count: "exact", head: true }).eq("contacto_id", c.id),
      ]);
      const total = (ci ?? 0) + (cg ?? 0) + (cn ?? 0);
      if (total > 0) {
        alert(`No se puede eliminar "${c.nombre}" porque tiene ${total} registro${total !== 1 ? "s" : ""} asociado${total !== 1 ? "s" : ""} (ingresos, pagos, facturas o notas de crédito).`);
        return;
      }
    } catch (err) {
      alert("Error al verificar: " + (err as Error).message);
      return;
    }
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

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--muted)]" />
          </div>
        ) : filtered.length === 0 ? (
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
          <>
          <table className="table">
            <thead>
              <tr>
                <SortHeader label="Nombre" sortKey="nombre" active={sortBy === "nombre"} dir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Tipo" sortKey="tipo" active={sortBy === "tipo"} dir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Identificación" sortKey="tax_id" active={sortBy === "tax_id"} dir={sortDir} onToggle={toggleSort} />
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => router.push(`/contactos/${c.id}`)}
                >
                  <td className="font-medium text-[var(--primary-hover)]">{c.nombre}</td>
                  <td>{badge(c.tipo)}</td>
                  <td className="text-[var(--muted)]">{c.tax_id || "—"}</td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
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
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            pageSizes={pagination.pageSizes}
            total={pagination.total}
            from={pagination.from}
            to={pagination.to}
            onPage={pagination.setPage}
            onPageSize={pagination.setPageSize}
          />
          </>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Editar contacto" : "Nuevo contacto"}>
        <form onSubmit={save} className="space-y-4">
          {editing && (
            <EntityMeta entity="contactos" entityId={editing.id} variant="block" />
          )}
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
              <label className="label">Identificación fiscal</label>
              <div className="flex gap-2 items-end">
                <input
                  className="input flex-1"
                  placeholder="CUIT, RFC, RUT…"
                  value={form.tax_id}
                  onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
                />
                <button
                  type="button"
                  className="btn btn-secondary shrink-0"
                  onClick={buscarCuit}
                  disabled={cuitLoading || form.tax_id.replace(/\D/g, "").length < 10}
                  title="Buscar razón social en AFIP (Argentina)"
                >
                  {cuitLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Buscar"}
                </button>
              </div>
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
