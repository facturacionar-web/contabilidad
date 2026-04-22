"use client";
import { useConfig } from "@/lib/useConfig";
import { COUNTRIES } from "@/lib/countries";
import { LogOut } from "lucide-react";

export default function Topbar({ userEmail }: { userEmail: string }) {
  const { config, country } = useConfig();
  return (
    <header className="h-16 bg-white border-b border-[var(--border)] px-6 flex items-center justify-between sticky top-0 z-20">
      <div>
        <h1 className="text-sm text-[var(--muted)]">
          {config?.empresa_nombre || "Mi Empresa"}
        </h1>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 rounded-lg">
          <span>{country.flag}</span>
          <span className="font-medium">{COUNTRIES[country.code].name}</span>
          <span className="text-[var(--muted)]">·</span>
          <span className="text-[var(--muted)]">{config?.moneda_base}</span>
        </span>
        <span className="text-[var(--muted)] hidden md:inline">{userEmail}</span>
        <form action="/auth/logout" method="POST">
          <button
            className="btn btn-ghost"
            title="Cerrar sesión"
            type="submit"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </form>
      </div>
    </header>
  );
}
