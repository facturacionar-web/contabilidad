"use client";
import { useEffect, useState, useCallback } from "react";
import { useConfig, saveConfig } from "@/lib/useConfig";
import { createClient } from "@/lib/supabase/client";
import { COUNTRIES, CountryCode, CURRENCIES, CurrencyCode } from "@/lib/countries";
import type { Config } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import { Save, Download, Upload, Trash2, Star, Users, Plus, KeyRound, X } from "lucide-react";

type SubUser = { id: string; email: string; created_at: string; last_sign_in_at?: string | null };

function UsuariosSection() {
  const [users, setUsers] = useState<SubUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newPass, setNewPass] = useState("");
  const [creating, setCreating] = useState(false);
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPass, setResetPass] = useState("");
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.user_metadata?.owner_id) { setIsAdmin(false); setLoading(false); return; }
    const res = await fetch("/api/admin/users");
    const data = await res.json();
    if (!res.ok) { setError(data.error); } else { setUsers(data.users); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const res = await fetch("/api/admin/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newEmail, password: newPass }),
    });
    const data = await res.json();
    setCreating(false);
    if (!res.ok) { alert("Error: " + data.error); return; }
    setNewEmail(""); setNewPass("");
    await load();
  }

  async function remove(id: string, email: string) {
    if (!confirm(`¿Eliminar usuario ${email}?`)) return;
    const res = await fetch(`/api/admin/users?id=${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) { alert("Error: " + data.error); return; }
    await load();
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetting(true);
    const res = await fetch("/api/admin/users", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: resetId, password: resetPass }),
    });
    const data = await res.json();
    setResetting(false);
    if (!res.ok) { alert("Error: " + data.error); return; }
    setResetId(null); setResetPass(""); alert("Contraseña actualizada.");
  }

  if (!isAdmin) return null;

  return (
    <div className="card max-w-3xl mt-8">
      <div className="flex items-center gap-2 mb-1">
        <Users className="w-5 h-5 text-[var(--primary)]" />
        <h3 className="font-semibold">Usuarios</h3>
      </div>
      <p className="text-sm text-[var(--muted)] mb-4">
        Creá usuarios que pueden acceder a la misma cuenta. Ellos inician sesión en{" "}
        <span className="font-medium">/login</span> con las credenciales que les asignés.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
          <strong>Error:</strong> {error}
          {error.includes("SERVICE_ROLE_KEY") && (
            <p className="mt-1">Agregá <code className="bg-red-100 px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code> en las variables de entorno de Railway.</p>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Cargando usuarios…</p>
      ) : (
        <>
          {users.length > 0 && (
            <div className="mb-5 border border-[var(--border)] rounded-lg overflow-hidden">
              <table className="table text-sm">
                <thead><tr><th>Email</th><th>Creado</th><th>Último acceso</th><th className="text-right">Acciones</th></tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td className="font-medium">{u.email}</td>
                      <td className="text-[var(--muted)]">{u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}</td>
                      <td className="text-[var(--muted)]">{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : "Nunca"}</td>
                      <td className="text-right whitespace-nowrap">
                        <button className="btn btn-ghost p-1.5" title="Cambiar contraseña" onClick={() => { setResetId(u.id); setResetPass(""); }}>
                          <KeyRound className="w-4 h-4" />
                        </button>
                        <button className="btn btn-ghost p-1.5 text-red-600" title="Eliminar usuario" onClick={() => remove(u.id, u.email ?? "")}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {resetId && (
            <form onSubmit={resetPassword} className="bg-slate-50 border border-[var(--border)] rounded-lg p-4 mb-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Cambiar contraseña</p>
                <button type="button" onClick={() => setResetId(null)}><X className="w-4 h-4 text-[var(--muted)]" /></button>
              </div>
              <input type="password" className="input" placeholder="Nueva contraseña (mín. 6 caracteres)" minLength={6} required
                value={resetPass} onChange={e => setResetPass(e.target.value)} />
              <button type="submit" className="btn btn-primary btn-sm" disabled={resetting}>
                {resetting ? "Guardando…" : "Guardar contraseña"}
              </button>
            </form>
          )}

          <form onSubmit={create} className="space-y-3">
            <p className="text-sm font-medium flex items-center gap-1"><Plus className="w-4 h-4" /> Nuevo usuario</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Email</label>
                <input type="email" className="input" required value={newEmail} onChange={e => setNewEmail(e.target.value)} />
              </div>
              <div>
                <label className="label">Contraseña (mín. 6 caracteres)</label>
                <input type="password" className="input" required minLength={6} value={newPass} onChange={e => setNewPass(e.target.value)} />
              </div>
            </div>
            <button type="submit" className="btn btn-secondary" disabled={creating}>
              {creating ? "Creando…" : "Crear usuario"}
            </button>
          </form>

        </>
      )}
    </div>
  );
}

type FormState = {
  moneda_base: CurrencyCode;
  empresa_nombre: string;
  empresa_tax_id: string;
  empresa_email: string;
  empresa_telefono: string;
  empresa_direccion: string;
};

const PAISES_APP: CountryCode[] = ["MX", "AR", "CL"];

function emptyForm(pais: CountryCode): FormState {
  return {
    moneda_base: COUNTRIES[pais].currency,
    empresa_nombre: "",
    empresa_tax_id: "",
    empresa_email: "",
    empresa_telefono: "",
    empresa_direccion: "",
  };
}

function configToForm(c: Config): FormState {
  return {
    moneda_base: c.moneda_base,
    empresa_nombre: c.empresa_nombre ?? "",
    empresa_tax_id: c.empresa_tax_id ?? "",
    empresa_email: c.empresa_email ?? "",
    empresa_telefono: c.empresa_telefono ?? "",
    empresa_direccion: c.empresa_direccion ?? "",
  };
}

export default function ConfiguracionPage() {
  const { config, allConfigs, ready, reload } = useConfig();
  const [paisActivo, setPaisActivo] = useState<CountryCode>("MX");
  const [form, setForm] = useState<FormState>(emptyForm("MX"));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Inicializar con el país activo del dashboard
  useEffect(() => {
    if (config) {
      setPaisActivo(config.pais);
      setForm(configToForm(config));
    }
  }, [config]);

  if (!ready) return <p className="text-[var(--muted)] p-6">Cargando…</p>;

  function switchPais(pais: CountryCode) {
    setPaisActivo(pais);
    const existing = allConfigs.find((c) => c.pais === pais);
    setForm(existing ? configToForm(existing) : emptyForm(pais));
    setSaved(false);
  }

  const activeDashboardPais = allConfigs.find((c) => c.is_active)?.pais ?? config?.pais ?? "MX";

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // Guardar siempre activa este país en el dashboard
      const payload: Partial<Config> & { pais: string } = {
        pais: paisActivo,
        is_active: true,
        moneda_base: form.moneda_base,
        empresa_nombre: form.empresa_nombre || "Mi Empresa",
        empresa_tax_id: form.empresa_tax_id || null,
        empresa_email: form.empresa_email || null,
        empresa_telefono: form.empresa_telefono || null,
        empresa_direccion: form.empresa_direccion || null,
      };
      await saveConfig(payload);
      await reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      alert("Error al guardar: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function exportData() {
    try {
      const supabase = createClient();
      const [contactos, ingresos, gastos, notas] = await Promise.all([
        supabase.from("contactos").select("*"),
        supabase.from("ingresos").select("*"),
        supabase.from("gastos").select("*"),
        supabase.from("notas_credito").select("*"),
      ]);
      const data = {
        version: 2,
        exportedAt: new Date().toISOString(),
        contactos: contactos.data ?? [],
        ingresos: ingresos.data ?? [],
        gastos: gastos.data ?? [],
        notas_credito: notas.data ?? [],
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contabilidad_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Error al exportar: " + (err as Error).message);
    }
  }

  function importData() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        if (!confirm("Esto añadirá los registros del archivo a tu cuenta. ¿Continuar?")) return;
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("No autenticado");
        const tables = ["contactos", "ingresos", "gastos", "notas_credito"] as const;
        for (const table of tables) {
          const rows = (data[table] ?? []) as Record<string, unknown>[];
          if (rows.length === 0) continue;
          const clean = rows.map(({ id: _id, user_id: _uid, created_at: _ca, ...rest }) => ({
            ...rest,
            user_id: user.id,
          }));
          const { error } = await supabase.from(table).insert(clean as never);
          if (error) throw new Error(`Error en ${table}: ${error.message}`);
        }
        alert("Datos importados correctamente.");
        location.reload();
      } catch (err) {
        alert("Error al importar: " + (err as Error).message);
      }
    };
    input.click();
  }

  async function deleteAll() {
    if (!confirm("⚠️ Esto borrará TODOS tus datos (contactos, ingresos, gastos, notas). No se puede deshacer. ¿Continuar?")) return;
    if (!confirm("Confirma una vez más: ¿borrar todos los datos?")) return;
    try {
      const supabase = createClient();
      const tables = ["notas_credito", "gastos", "ingresos", "contactos"] as const;
      for (const table of tables) {
        const { error } = await supabase.from(table).delete().gte("id", 0);
        if (error) throw new Error(`Error borrando ${table}: ${error.message}`);
      }
      alert("Todos los datos fueron eliminados.");
      location.reload();
    } catch (err) {
      alert("Error: " + (err as Error).message);
    }
  }


  return (
    <>
      <PageHeader
        title="Configuración"
        description="Datos de la empresa por país"
      />

      {/* Selector de país */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {PAISES_APP.map((p) => {
          const tiene = allConfigs.some((c) => c.pais === p);
          const esActivo = p === activeDashboardPais;
          return (
            <button
              key={p}
              onClick={() => switchPais(p)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center gap-2 ${
                paisActivo === p
                  ? "bg-[var(--primary)] text-white border-[var(--primary)]"
                  : "bg-white border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)]"
              }`}
            >
              {COUNTRIES[p].flag} {COUNTRIES[p].name}
              {esActivo && <Star className="w-3 h-3 fill-current" />}
              {!tiene && <span className="text-[0.65rem] opacity-60">(sin datos)</span>}
            </button>
          );
        })}
      </div>

      <p className="text-sm text-[var(--muted)] mb-4 -mt-2">
        Al guardar, este país quedará activo en el dashboard y la barra superior.
      </p>

      <form onSubmit={handleSave} className="space-y-6 max-w-3xl">
        <div className="card">
          <h3 className="font-semibold mb-4">
            {COUNTRIES[paisActivo].flag} Datos de empresa — {COUNTRIES[paisActivo].name}
          </h3>
          <div className="space-y-4">
            <div>
              <label className="label">Moneda base *</label>
              <select
                className="select"
                value={form.moneda_base}
                onChange={(e) => setForm({ ...form, moneda_base: e.target.value as CurrencyCode })}
              >
                {Object.values(CURRENCIES).map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))}
              </select>
              <p className="text-xs text-[var(--muted)] mt-1">
                Moneda principal para el dashboard y los reportes cuando este país está activo.
              </p>
            </div>
            <div>
              <label className="label">Nombre / Razón social *</label>
              <input
                className="input"
                value={form.empresa_nombre}
                onChange={(e) => setForm({ ...form, empresa_nombre: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">{COUNTRIES[paisActivo].taxIdLabel}</label>
                <input
                  className="input"
                  placeholder={COUNTRIES[paisActivo].taxIdPlaceholder}
                  value={form.empresa_tax_id}
                  onChange={(e) => setForm({ ...form, empresa_tax_id: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Teléfono</label>
                <input
                  className="input"
                  value={form.empresa_telefono}
                  onChange={(e) => setForm({ ...form, empresa_telefono: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                value={form.empresa_email}
                onChange={(e) => setForm({ ...form, empresa_email: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Dirección</label>
              <input
                className="input"
                value={form.empresa_direccion}
                onChange={(e) => setForm({ ...form, empresa_direccion: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <Save className="w-4 h-4" />
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
          {saved && <span className="text-sm text-green-600 font-medium">✓ Guardado</span>}
        </div>
      </form>

      <UsuariosSection />

      <div className="card max-w-3xl mt-8">
        <h3 className="font-semibold mb-2">Respaldo de datos</h3>
        <p className="text-sm text-[var(--muted)] mb-4">
          Exportá un archivo JSON con todos tus registros como respaldo adicional.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary" type="button" onClick={exportData}>
            <Download className="w-4 h-4" /> Exportar datos
          </button>
          <button className="btn btn-secondary" type="button" onClick={importData}>
            <Upload className="w-4 h-4" /> Importar datos
          </button>
          <button className="btn btn-danger" type="button" onClick={deleteAll}>
            <Trash2 className="w-4 h-4" /> Borrar todo
          </button>
        </div>
      </div>
    </>
  );
}
