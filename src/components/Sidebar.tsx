"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard,
  Users,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Settings,
  Wallet,
  ChevronDown,
  Layers,
  Building2,
  Receipt,
  CreditCard,
  FileMinus,
  ArrowDownCircle,
  Package,
  Trash2,
  History,
  Scale,
  FileText,
} from "lucide-react";
import { useConfig } from "@/lib/useConfig";
import type { CountryCode } from "@/lib/countries";

type SubItem = { href: string; label: string };
type NavGroup = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: SubItem[];
  paises?: CountryCode[]; // si está, solo se muestra cuando config.pais coincide
};
type NavLink = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  paises?: CountryCode[];
};

const nav: (NavLink | NavGroup)[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contactos", label: "Contactos", icon: Users },
  {
    key: "ingresos",
    label: "Ingresos",
    icon: TrendingUp,
    children: [
      { href: "/ingresos/pagos-recibidos", label: "Pagos recibidos" },
      { href: "/ingresos/notas-credito", label: "Notas de crédito" },
    ],
  },
  {
    key: "egresos",
    label: "Egresos",
    icon: TrendingDown,
    children: [
      { href: "/egresos/facturas", label: "Facturas" },
      { href: "/egresos/pagos", label: "Pagos" },
      { href: "/egresos/carga-masiva", label: "Carga masiva de facturas" },
    ],
  },
  { href: "/conceptos", label: "Conceptos", icon: Layers },
  { href: "/cuentas", label: "Cuentas", icon: Building2 },
  { href: "/conciliacion", label: "Conciliación", icon: Scale },
  {
    key: "arca",
    label: "ARCA",
    icon: FileText,
    paises: ["AR"],
    children: [
      { href: "/arca/resumen-mensual", label: "Resumen mensual" },
      { href: "/arca/comprobantes", label: "Comprobantes emitidos" },
      { href: "/arca/ventas-ml", label: "Ventas Mercado Libre" },
      { href: "/arca/conciliacion-ml", label: "Conciliación con ML" },
    ],
  },
  { href: "/proveedores", label: "Gastos por proveedor", icon: Package },
  {
    key: "reportes",
    label: "Reportes",
    icon: BarChart3,
    children: [
      { href: "/reportes/gastos", label: "Gastos" },
      { href: "/reportes/retenciones", label: "Retenciones" },
      { href: "/reportes/libro-diario", label: "Libro diario" },
    ],
  },
  { href: "/historial", label: "Historial", icon: History },
  { href: "/papelera", label: "Papelera", icon: Trash2 },
  { href: "/configuracion", label: "Configuración", icon: Settings },
];

function isGroup(item: NavLink | NavGroup): item is NavGroup {
  return "children" in item;
}

export default function Sidebar() {
  const pathname = usePathname();
  const { config } = useConfig();
  const paisActivo = config?.pais as CountryCode | undefined;

  const visibleNav = useMemo(
    () =>
      nav.filter(
        (item) => !item.paises || (paisActivo && item.paises.includes(paisActivo)),
      ),
    [paisActivo],
  );

  // Auto-expand groups based on current path
  const initialOpen: Record<string, boolean> = {};
  for (const item of visibleNav) {
    if (isGroup(item)) {
      initialOpen[item.key] = item.children.some((c) =>
        pathname.startsWith(c.href)
      );
    }
  }
  const [open, setOpen] = useState<Record<string, boolean>>(initialOpen);

  // Re-evaluate when pathname changes
  useEffect(() => {
    setOpen((prev) => {
      const next = { ...prev };
      for (const item of visibleNav) {
        if (isGroup(item)) {
          if (item.children.some((c) => pathname.startsWith(c.href))) {
            next[item.key] = true;
          }
        }
      }
      return next;
    });
  }, [pathname, visibleNav]);

  const toggle = (key: string) =>
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const linkClass = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      active
        ? "bg-[var(--primary-soft)] text-[var(--primary-hover)]"
        : "text-slate-600 hover:bg-slate-100"
    }`;

  return (
    <aside className="w-64 bg-white border-r border-[var(--border)] flex flex-col fixed inset-y-0 left-0">
      <div className="h-16 px-6 flex items-center border-b border-[var(--border)] gap-2">
        <Wallet className="w-6 h-6 text-[var(--primary)]" />
        <span className="font-semibold text-lg">Alegrant</span>
      </div>

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {visibleNav.map((item) => {
          if (!isGroup(item)) {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={linkClass(active)}>
                <Icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            );
          }

          // Dropdown group
          const Icon = item.icon;
          const isOpen = open[item.key];
          const groupActive = item.children.some((c) =>
            pathname.startsWith(c.href)
          );

          return (
            <div key={item.key}>
              <button
                onClick={() => toggle(item.key)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  groupActive
                    ? "text-[var(--primary-hover)]"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                    isOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {isOpen && (
                <div className="ml-4 mt-0.5 pl-3 border-l border-[var(--border)] space-y-0.5">
                  {item.children.map((child) => {
                    const childActive = pathname.startsWith(child.href);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                          childActive
                            ? "bg-[var(--primary-soft)] text-[var(--primary-hover)] font-medium"
                            : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        }`}
                      >
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="p-4 border-t border-[var(--border)] text-xs text-[var(--muted)]">
        v1.1 · Alegrant
      </div>
    </aside>
  );
}
