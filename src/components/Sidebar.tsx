"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  TrendingUp,
  TrendingDown,
  FileMinus,
  BarChart3,
  Settings,
  Wallet,
} from "lucide-react";

const nav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contactos", label: "Contactos", icon: Users },
  { href: "/ingresos", label: "Ingresos", icon: TrendingUp },
  { href: "/gastos", label: "Gastos y Facturas", icon: TrendingDown },
  { href: "/notas-credito", label: "Notas de crédito", icon: FileMinus },
  { href: "/reportes", label: "Reportes", icon: BarChart3 },
  { href: "/configuracion", label: "Configuración", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-64 bg-white border-r border-[var(--border)] flex flex-col fixed inset-y-0 left-0">
      <div className="h-16 px-6 flex items-center border-b border-[var(--border)] gap-2">
        <Wallet className="w-6 h-6 text-[var(--primary)]" />
        <span className="font-semibold text-lg">Contabilidad</span>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {nav.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-[var(--primary-soft)] text-[var(--primary-hover)]"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-[var(--border)] text-xs text-[var(--muted)]">
        v1.0 · Datos locales
      </div>
    </aside>
  );
}
