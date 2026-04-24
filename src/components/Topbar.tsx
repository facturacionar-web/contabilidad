"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConfig, saveConfig } from "@/lib/useConfig";
import { useTable, paisFilter } from "@/lib/useSupabaseData";
import { COUNTRIES } from "@/lib/countries";
import { LogOut, ChevronDown, Check, Search } from "lucide-react";

const PAISES_APP = ["MX", "AR", "CL"] as const;

export default function Topbar({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  const { config, allConfigs, country } = useConfig();
  const pais = config?.pais;
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [search, setSearch] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const { data: contactos } = useTable("contactos", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });

  const contactosFiltrados = search.trim()
    ? (contactos ?? []).filter((c) =>
        c.nombre.toLowerCase().includes(search.toLowerCase()) ||
        (c.tax_id?.toLowerCase() ?? "").includes(search.toLowerCase())
      ).slice(0, 6)
    : [];

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchFocus(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // Cerrar dropdown al hacer clic afuera
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  async function switchPais(pais: string) {
    if (pais === config?.pais || switching) return;
    const existe = allConfigs.some((c) => c.pais === pais);
    setSwitching(true);
    setOpen(false);
    try {
      await saveConfig({
        pais: pais as never,
        is_active: true,
        moneda_base: COUNTRIES[pais as keyof typeof COUNTRIES].currency,
        empresa_nombre: existe
          ? allConfigs.find((c) => c.pais === pais)!.empresa_nombre
          : "Mi Empresa",
      });
      // Recarga completa para que todos los componentes vean el nuevo país
      window.location.href = "/";
    } catch (err) {
      alert("Error: " + (err as Error).message);
      setSwitching(false);
    }
  }

  return (
    <header className="h-16 bg-white border-b border-[var(--border)] px-6 flex items-center gap-4 sticky top-0 z-20">
      <div className="shrink-0">
        <h1 className="text-sm text-[var(--muted)]">
          {config?.empresa_nombre || "Mi Empresa"}
        </h1>
      </div>

      <div className="flex-1 max-w-sm relative" ref={searchRef}>
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
        <input
          className="input pl-9 w-full text-sm"
          placeholder="Buscar contacto…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setSearchFocus(true)}
        />
        {(searchFocus || search) && contactosFiltrados.length > 0 && (
          <div className="absolute top-full mt-1 w-full bg-white border border-[var(--border)] rounded-xl shadow-lg z-50 overflow-hidden">
            {contactosFiltrados.map((c) => (
              <button key={c.id}
                className="w-full px-4 py-2.5 text-left hover:bg-slate-50 flex items-center justify-between gap-3"
                onClick={() => { setSearch(""); setSearchFocus(false); router.push(`/contactos/${c.id}`); }}>
                <span className="font-medium text-sm">{c.nombre}</span>
                <span className="text-xs text-[var(--muted)] shrink-0">{c.tipo}{c.tax_id ? ` · ${c.tax_id}` : ""}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ml-auto">

      <div className="flex items-center gap-3 text-sm">
        {/* Country switcher */}
        <div className="relative" ref={ref}>
          <button
            onClick={() => setOpen((v) => !v)}
            disabled={switching}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
          >
            <span>{country.flag}</span>
            <span className="font-medium">{COUNTRIES[country.code].name}</span>
            <span className="text-[var(--muted)]">·</span>
            <span className="text-[var(--muted)]">{config?.moneda_base}</span>
            <ChevronDown className={`w-3.5 h-3.5 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`} />
          </button>

          {open && (
            <div className="absolute right-0 mt-1 w-48 bg-white border border-[var(--border)] rounded-xl shadow-lg py-1 z-50">
              {PAISES_APP.map((p) => {
                const isActive = config?.pais === p;
                const tiene = allConfigs.some((c) => c.pais === p);
                return (
                  <button
                    key={p}
                    onClick={() => switchPais(p)}
                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between hover:bg-slate-50 transition-colors ${isActive ? "font-semibold" : ""}`}
                  >
                    <span className="flex items-center gap-2">
                      <span>{COUNTRIES[p].flag}</span>
                      <span>{COUNTRIES[p].name}</span>
                      {!tiene && <span className="text-[0.65rem] text-[var(--muted)]">nuevo</span>}
                    </span>
                    {isActive && <Check className="w-3.5 h-3.5 text-[var(--primary)]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <span className="text-[var(--muted)] hidden md:inline">{userEmail}</span>
        <form action="/auth/logout" method="POST">
          <button className="btn btn-ghost" title="Cerrar sesión" type="submit">
            <LogOut className="w-4 h-4" />
          </button>
        </form>
      </div>
      </div>
    </header>
  );
}
