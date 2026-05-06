"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTable, paisFilter } from "@/lib/useSupabaseData";
import { useConfig } from "@/lib/useConfig";
import {
  Search,
  Receipt,
  CreditCard,
  Users,
  Layers,
  Building2,
  FileMinus,
  TrendingUp,
  ArrowRight,
  Loader2,
  Plus,
  LayoutDashboard,
  BarChart3,
} from "lucide-react";

type Action = {
  id: string;
  label: string;
  hint?: string;
  href: string;
  group: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string;
};

export default function CommandPalette() {
  const router = useRouter();
  const { config } = useConfig();
  const pais = config?.pais;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Datos: cargamos solo cuando está abierto ───────────────────────────
  const { data: facturas } = useTable("gastos", {
    orderBy: "fecha",
    filter: [...(paisFilter(pais) ?? []), { column: "tipo", op: "eq", value: "factura_proveedor" }],
    skip: !pais || !open,
    deps: [pais, open],
  });
  const { data: pagos } = useTable("gastos", {
    orderBy: "fecha",
    filter: [...(paisFilter(pais) ?? []), { column: "tipo", op: "eq", value: "gasto" }],
    skip: !pais || !open,
    deps: [pais, open],
  });
  const { data: contactos } = useTable("contactos", {
    orderBy: "nombre", ascending: true,
    filter: paisFilter(pais), skip: !pais || !open, deps: [pais, open],
  });
  const { data: conceptos } = useTable("conceptos", {
    orderBy: "nombre", ascending: true,
    filter: paisFilter(pais), skip: !pais || !open, deps: [pais, open],
  });
  const { data: cuentas } = useTable("cuentas", {
    orderBy: "nombre", ascending: true,
    filter: paisFilter(pais), skip: !pais || !open, deps: [pais, open],
  });
  const { data: notasCredito } = useTable("notas_credito", {
    orderBy: "fecha",
    filter: paisFilter(pais), skip: !pais || !open, deps: [pais, open],
  });

  const loading = open && (facturas === undefined || contactos === undefined);

  // ── Listener global para Cmd+K / Ctrl+K ─────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      // "/" abre la búsqueda si no estamos en un input
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName) &&
        !(e.target as HTMLElement).isContentEditable
      ) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape" && open) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus input al abrir
  useEffect(() => {
    if (open) {
      setQ("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // ── Acciones rápidas (siempre visibles) ─────────────────────────────────
  const quickActions: Action[] = useMemo(() => [
    { id: "go-dashboard", label: "Ir al Dashboard", href: "/", group: "Navegación", icon: LayoutDashboard, keywords: "inicio home" },
    { id: "go-facturas", label: "Facturas", href: "/egresos/facturas", group: "Navegación", icon: Receipt, keywords: "egresos" },
    { id: "go-pagos", label: "Pagos", href: "/egresos/pagos", group: "Navegación", icon: CreditCard, keywords: "egresos" },
    { id: "go-pagos-recibidos", label: "Pagos recibidos", href: "/ingresos/pagos-recibidos", group: "Navegación", icon: TrendingUp, keywords: "ingresos cobros" },
    { id: "go-notas", label: "Notas de crédito", href: "/ingresos/notas-credito", group: "Navegación", icon: FileMinus, keywords: "ingresos nc" },
    { id: "go-contactos", label: "Contactos", href: "/contactos", group: "Navegación", icon: Users, keywords: "proveedores clientes" },
    { id: "go-conceptos", label: "Conceptos", href: "/conceptos", group: "Navegación", icon: Layers },
    { id: "go-cuentas", label: "Cuentas", href: "/cuentas", group: "Navegación", icon: Building2, keywords: "bancos" },
    { id: "go-reportes", label: "Reportes", href: "/reportes", group: "Navegación", icon: BarChart3 },
    { id: "new-factura", label: "Nueva factura", href: "/egresos/facturas?nuevo=1", group: "Crear", icon: Plus, keywords: "agregar nuevo" },
    { id: "new-pago", label: "Nuevo pago", href: "/egresos/pagos?nuevo=1", group: "Crear", icon: Plus, keywords: "agregar nuevo" },
    { id: "new-ingreso", label: "Nuevo ingreso", href: "/ingresos/pagos-recibidos?nuevo=1", group: "Crear", icon: Plus, keywords: "agregar nuevo cobro" },
    { id: "new-contacto", label: "Nuevo contacto", href: "/contactos?nuevo=1", group: "Crear", icon: Plus, keywords: "agregar nuevo proveedor cliente" },
    { id: "carga-masiva", label: "Carga masiva de facturas", href: "/egresos/carga-masiva", group: "Crear", icon: Plus, keywords: "excel importar" },
  ], []);

  // ── Construir lista filtrada ────────────────────────────────────────────
  const results: Action[] = useMemo(() => {
    if (!open) return [];
    const query = q.trim().toLowerCase();
    const all: Action[] = [];

    // Acciones rápidas
    for (const a of quickActions) {
      const txt = `${a.label} ${a.keywords ?? ""}`.toLowerCase();
      if (!query || txt.includes(query)) all.push(a);
    }

    if (query) {
      // Facturas: buscar por número, concepto, proveedor
      const proveedorMap = new Map<number, string>();
      for (const c of (contactos ?? [])) proveedorMap.set(c.id, c.nombre);

      for (const f of (facturas ?? [])) {
        const prov = f.contacto_id ? proveedorMap.get(f.contacto_id) ?? "" : "";
        const txt = `${f.numero_factura ?? ""} ${f.concepto} ${prov}`.toLowerCase();
        if (txt.includes(query)) {
          all.push({
            id: `f-${f.id}`,
            label: `Factura ${f.numero_factura ?? `#${f.id}`}`,
            hint: `${prov} · ${f.concepto} · ${f.fecha}`,
            href: `/egresos/facturas?editar=${f.id}`,
            group: "Facturas",
            icon: Receipt,
          });
        }
      }
      for (const p of (pagos ?? [])) {
        const prov = p.contacto_id ? proveedorMap.get(p.contacto_id) ?? "" : "";
        const txt = `${p.numero_factura ?? ""} ${p.concepto} ${prov}`.toLowerCase();
        if (txt.includes(query)) {
          all.push({
            id: `p-${p.id}`,
            label: `Pago #${p.id}`,
            hint: `${prov} · ${p.concepto} · ${p.fecha}`,
            href: `/egresos/pagos?editar=${p.id}`,
            group: "Pagos",
            icon: CreditCard,
          });
        }
      }
      for (const n of (notasCredito ?? [])) {
        const prov = n.contacto_id ? proveedorMap.get(n.contacto_id) ?? "" : "";
        const txt = `${n.numero ?? ""} ${n.concepto} ${prov}`.toLowerCase();
        if (txt.includes(query)) {
          all.push({
            id: `nc-${n.id}`,
            label: `Nota de crédito ${n.numero ?? `#${n.id}`}`,
            hint: `${prov} · ${n.concepto}`,
            href: `/ingresos/notas-credito?editar=${n.id}`,
            group: "Notas de crédito",
            icon: FileMinus,
          });
        }
      }
      // Contactos
      for (const c of (contactos ?? [])) {
        const txt = `${c.nombre} ${c.tax_id ?? ""}`.toLowerCase();
        if (txt.includes(query)) {
          all.push({
            id: `c-${c.id}`,
            label: c.nombre,
            hint: `${c.tipo}${c.tax_id ? ` · ${c.tax_id}` : ""}`,
            href: `/contactos/${c.id}`,
            group: "Contactos",
            icon: Users,
          });
        }
      }
      // Conceptos
      for (const c of (conceptos ?? [])) {
        if (c.nombre.toLowerCase().includes(query)) {
          all.push({
            id: `co-${c.id}`,
            label: c.nombre,
            hint: c.tipo,
            href: "/conceptos",
            group: "Conceptos",
            icon: Layers,
          });
        }
      }
      // Cuentas
      for (const c of (cuentas ?? [])) {
        if (c.nombre.toLowerCase().includes(query)) {
          all.push({
            id: `cu-${c.id}`,
            label: c.nombre,
            hint: `${c.tipo} · ${c.moneda}`,
            href: "/cuentas",
            group: "Cuentas",
            icon: Building2,
          });
        }
      }
    }

    // Limitar resultados
    return all.slice(0, 50);
  }, [q, open, facturas, pagos, contactos, conceptos, cuentas, notasCredito, quickActions]);

  // Reset active index al cambiar query
  useEffect(() => { setActiveIdx(0); }, [q]);

  // Scroll del item activo a la vista
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[activeIdx];
      if (r) navigate(r);
    }
  }

  function navigate(a: Action) {
    setOpen(false);
    setQ("");
    router.push(a.href);
  }

  if (!open) return null;

  // Agrupar resultados
  const grouped = new Map<string, Action[]>();
  for (const r of results) {
    if (!grouped.has(r.group)) grouped.set(r.group, []);
    grouped.get(r.group)!.push(r);
  }

  let runningIdx = 0;

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-start justify-center pt-[10vh] p-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden border border-[var(--border)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
          <Search className="w-5 h-5 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar facturas, pagos, contactos, conceptos…"
            className="flex-1 bg-transparent outline-none text-base placeholder:text-slate-400"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
            ESC
          </kbd>
        </div>

        {/* Resultados */}
        <div ref={listRef} className="flex-1 overflow-y-auto max-h-[60vh]">
          {loading && results.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-slate-400 text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Cargando…
            </div>
          ) : results.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              {q.trim() ? "Sin resultados para esta búsqueda" : "Empezá a escribir para buscar"}
            </div>
          ) : (
            <div className="py-2">
              {[...grouped.entries()].map(([group, items]) => (
                <div key={group}>
                  <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {group}
                  </div>
                  {items.map((item) => {
                    const Icon = item.icon;
                    const idx = runningIdx++;
                    const isActive = idx === activeIdx;
                    return (
                      <button
                        key={item.id}
                        data-idx={idx}
                        onClick={() => navigate(item)}
                        onMouseMove={() => setActiveIdx(idx)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          isActive
                            ? "bg-[var(--primary-soft)]"
                            : "hover:bg-slate-50"
                        }`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-[var(--primary)]" : "text-slate-400"}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm truncate ${isActive ? "font-semibold text-[var(--primary-hover)]" : "font-medium text-slate-700"}`}>
                            {item.label}
                          </p>
                          {item.hint && (
                            <p className="text-xs text-slate-500 truncate">{item.hint}</p>
                          )}
                        </div>
                        {isActive && (
                          <ArrowRight className="w-3.5 h-3.5 text-[var(--primary)] shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer con tips */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border)] bg-slate-50/60 text-[11px] text-slate-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="bg-white border border-slate-200 px-1 rounded text-[9px]">↑↓</kbd>
              navegar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-white border border-slate-200 px-1 rounded text-[9px]">↵</kbd>
              abrir
            </span>
          </div>
          <span className="flex items-center gap-1">
            <kbd className="bg-white border border-slate-200 px-1 rounded text-[9px]">Ctrl</kbd>
            +
            <kbd className="bg-white border border-slate-200 px-1 rounded text-[9px]">K</kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
