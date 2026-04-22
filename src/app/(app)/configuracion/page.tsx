"use client";
import { useEffect, useState } from "react";
import { useConfig, saveConfig } from "@/lib/useConfig";
import { createClient } from "@/lib/supabase/client";
import { COUNTRIES, CountryCode, CURRENCIES, CurrencyCode } from "@/lib/countries";
import type { Config } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import { Save, Download, Upload, Trash2 } from "lucide-react";

type FormState = {
  pais: CountryCode;
  moneda_base: CurrencyCode;
  empresa_nombre: string;
  empresa_tax_id: string;
  empresa_email: string;
  empresa_telefono: string;
  empresa_direccion: string;
};

export default function ConfiguracionPage() {
  const { config, ready, reload } = useConfig();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) {
      setForm({
        pais: config.pais,
        moneda_base: config.moneda_base,
        empresa_nombre: config.empresa_nombre ?? "",
        empresa_tax_id: config.empresa_tax_id ?? "",
        empresa_email: config.empresa_email ?? "",
        empresa_telefono: config.empresa_telefono ?? "",
        empresa_direccion: config.empresa_direccion ?? "",
      });
    }
  }, [config]);

  if (!ready || !form) return <p className="text-[var(--muted)] p-6">Cargando…</p>;

  function changeCountry(code: CountryCode) {
    setForm((f) => f ? { ...f, pais: code, moneda_base: COUNTRIES[code].currency } : f);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const payload: Partial<Config> = {
        pais: form.pais,
        moneda_base: form.moneda_base,
        empresa_nombre: form.empresa_nombre,
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
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
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
        if (
          !confirm(
            "Esto añadirá los registros del archivo a tu cuenta actual. Los registros existentes NO se borrarán. ¿Continuar?"
          )
        )
          return;
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("No autenticado");

        const tables = ["contactos", "ingresos", "gastos", "notas_credito"] as const;
        for (const table of tables) {
          const rows = (data[table] ?? []) as Record<string, unknown>[];
          if (rows.length === 0) continue;
          // Strip existing id/user_id so Supabase assigns new ones
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
    if (
      !confirm(
        "⚠️ Esto borrará TODOS tus datos (contactos, ingresos, gastos, notas). No se puede deshacer. ¿Continuar?"
      )
    )
      return;
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
        description="Datos de la empresa, país y moneda"
      />

      <form onSubmit={handleSave} className="space-y-6 max-w-3xl">
        <div className="card">
          <h3 className="font-semibold mb-4">País y moneda</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">País *</label>
              <select
                className="select"
                value={form.pais}
                onChange={(e) => changeCountry(e.target.value as CountryCode)}
              >
                {Object.values(COUNTRIES).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[var(--muted)] mt-1">
                Define el IVA por defecto y el formato del identificador fiscal
                ({COUNTRIES[form.pais].taxIdLabel}).
              </p>
            </div>
            <div>
              <label className="label">Moneda base *</label>
              <select
                className="select"
                value={form.moneda_base}
                onChange={(e) =>
                  setForm({ ...form, moneda_base: e.target.value as CurrencyCode })
                }
              >
                {Object.values(CURRENCIES).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[var(--muted)] mt-1">
                Moneda principal para el dashboard y los reportes.
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold mb-4">Datos de la empresa</h3>
          <div className="space-y-4">
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
                <label className="label">{COUNTRIES[form.pais].taxIdLabel}</label>
                <input
                  className="input"
                  placeholder={COUNTRIES[form.pais].taxIdPlaceholder}
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
                onChange={(e) =>
                  setForm({ ...form, empresa_direccion: e.target.value })
                }
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

      <div className="card max-w-3xl mt-8">
        <h3 className="font-semibold mb-2">Respaldo de datos</h3>
        <p className="text-sm text-[var(--muted)] mb-4">
          Exporta un archivo JSON con todos tus datos como respaldo adicional,
          o importa datos de una exportación anterior.
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
