"use client";
import { useTable, paisFilter } from "@/lib/useSupabaseData";
import { useConfig } from "@/lib/useConfig";
import { formatMoney, formatDate, monthRange, todayISO } from "@/lib/format";
import {
  TrendingUp,
  TrendingDown,
  FileMinus,
  Users,
  Wallet,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";

export default function Dashboard() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const { start, end } = monthRange(todayISO());

  const { data: ingresos } = useTable("ingresos", { orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: gastos } = useTable("gastos", { orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: notas } = useTable("notas_credito", { orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: contactos } = useTable("contactos", { orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais] });

  const inRange = <T extends { fecha: string }>(rows: T[] | undefined) =>
    (rows ?? []).filter((r) => r.fecha >= start && r.fecha <= end);

  const ingresosMes = inRange(ingresos);
  const gastosMes = inRange(gastos);
  const notasMes = inRange(notas);

  const base = config?.moneda_base ?? "MXN";
  const sumIngresos = ingresosMes
    .filter((x) => x.moneda === base)
    .reduce((s, x) => s + Number(x.monto), 0);
  const sumGastos = gastosMes
    .filter((x) => x.moneda === base)
    .reduce((s, x) => s + Number(x.total), 0);
  const sumNotas = notasMes
    .filter((x) => x.moneda === base)
    .reduce((s, x) => s + Number(x.monto), 0);
  const balance = sumIngresos - sumGastos;

  const pendientes = (gastos ?? []).filter(
    (g) => g.estado === "pendiente" || g.estado === "parcial"
  );
  const pendientesMonto = pendientes
    .filter((g) => g.moneda === base)
    .reduce((s, g) => s + (Number(g.total) - Number(g.monto_pagado)), 0);

  const kpis = [
    { label: "Ingresos del mes", value: sumIngresos, icon: TrendingUp, color: "text-green-600", bg: "bg-green-50" },
    { label: "Gastos del mes", value: sumGastos, icon: TrendingDown, color: "text-red-600", bg: "bg-red-50" },
    { label: "Balance del mes", value: balance, icon: Wallet, color: balance >= 0 ? "text-teal-600" : "text-red-600", bg: balance >= 0 ? "bg-teal-50" : "bg-red-50" },
    { label: "Por pagar", value: pendientesMonto, icon: FileMinus, color: "text-amber-600", bg: "bg-amber-50" },
  ];

  const recentIngresos = [...ingresosMes].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 5);
  const recentGastos = [...gastosMes].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 5);

  return (
    <>
      <PageHeader
        title={`Hola, ${config?.empresa_nombre ?? ""}`}
        description={`Resumen de ${new Date().toLocaleDateString(country.locale, { month: "long", year: "numeric" })} (moneda base ${base})`}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-[var(--muted)]">{k.label}</span>
                <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${k.bg}`}>
                  <Icon className={`w-4 h-4 ${k.color}`} />
                </span>
              </div>
              <div className="text-2xl font-semibold">{formatMoney(k.value, base, country.locale)}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <RecentList
          title="Últimos ingresos"
          href="/ingresos"
          empty="Aún no hay ingresos registrados este mes."
          rows={recentIngresos.map((i) => ({
            id: i.id, label: i.concepto, sublabel: i.categoria,
            amount: Number(i.monto), currency: i.moneda, date: i.fecha, positive: true,
          }))}
          locale={country.locale}
        />
        <RecentList
          title="Últimos gastos"
          href="/gastos"
          empty="Aún no hay gastos registrados este mes."
          rows={recentGastos.map((g) => ({
            id: g.id, label: g.concepto,
            sublabel: g.tipo === "factura_proveedor" ? "Factura proveedor" : g.categoria,
            amount: Number(g.total), currency: g.moneda, date: g.fecha, positive: false,
          }))}
          locale={country.locale}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={<Users className="w-5 h-5" />} label="Contactos" value={contactos?.length ?? 0} href="/contactos" />
        <StatCard
          icon={<FileMinus className="w-5 h-5" />}
          label="Notas de crédito (mes)"
          value={notasMes.length}
          href="/notas-credito"
          extra={sumNotas > 0 ? formatMoney(sumNotas, base, country.locale) : undefined}
        />
        <StatCard icon={<TrendingDown className="w-5 h-5" />} label="Facturas pendientes" value={pendientes.length} href="/gastos" />
      </div>
    </>
  );
}

function RecentList({
  title, href, rows, empty, locale,
}: {
  title: string; href: string;
  rows: { id: number; label: string; sublabel: string; amount: number; currency: string; date: string; positive: boolean; }[];
  empty: string; locale: string;
}) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        <Link href={href} className="text-sm text-[var(--primary)] hover:underline flex items-center gap-1">
          Ver todos <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-[var(--muted)]">{empty}</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((r) => (
            <li key={r.id} className="px-5 py-3 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{r.label}</p>
                <p className="text-xs text-[var(--muted)]">{r.sublabel} · {formatDate(r.date, locale)}</p>
              </div>
              <span className={`text-sm font-semibold shrink-0 ml-3 ${r.positive ? "text-green-600" : "text-red-600"}`}>
                {r.positive ? "+" : "-"}{formatMoney(r.amount, r.currency as never, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatCard({
  icon, label, value, extra, href,
}: {
  icon: React.ReactNode; label: string; value: number; extra?: string; href: string;
}) {
  return (
    <Link href={href} className="card hover:border-[var(--primary)] transition-colors">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[var(--primary-soft)] text-[var(--primary-hover)] flex items-center justify-center">
          {icon}
        </div>
        <div>
          <p className="text-sm text-[var(--muted)]">{label}</p>
          <p className="text-xl font-semibold">
            {value}
            {extra && <span className="text-sm text-[var(--muted)] ml-2">{extra}</span>}
          </p>
        </div>
      </div>
    </Link>
  );
}
