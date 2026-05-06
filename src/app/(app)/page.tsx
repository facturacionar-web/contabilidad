"use client";
import { useMemo } from "react";
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
  ArrowUp,
  ArrowDown,
  BarChart3,
  Minus,
} from "lucide-react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import PaymentCalendar from "@/components/PaymentCalendar";
import MonthlyBarChart from "@/components/MonthlyBarChart";
import TopProveedores from "@/components/TopProveedores";
import CashFlowForecast from "@/components/CashFlowForecast";

// Helpers de fechas para mes anterior y rango de 6 meses
function shiftMonth(iso: string, delta: number): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function monthName(iso: string, locale: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: "short" });
}

export default function Dashboard() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const { start, end } = monthRange(todayISO());

  const { data: ingresos } = useTable("ingresos", { orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais] });
  // Pagos reales (tipo="gasto") — filtro en DB para no mezclar con facturas
  const { data: pagosDB } = useTable("gastos", {
    orderBy: "fecha",
    filter: [...(paisFilter(pais) ?? []), { column: "tipo", op: "eq", value: "gasto" }],
    skip: !pais, deps: [pais],
  });
  // Facturas — solo para calcular "por pagar"
  const { data: facturasDB } = useTable("gastos", {
    orderBy: "fecha",
    filter: [...(paisFilter(pais) ?? []), { column: "tipo", op: "eq", value: "factura_proveedor" }],
    skip: !pais, deps: [pais],
  });
  const { data: notas } = useTable("notas_credito", { orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: contactos } = useTable("contactos", { orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais] });

  const inRange = <T extends { fecha: string }>(rows: T[] | undefined) =>
    (rows ?? []).filter((r) => r.fecha >= start && r.fecha <= end);

  const ingresosMes = inRange(ingresos);
  const notasMes = inRange(notas);
  const pagosMes = inRange(pagosDB);

  const base = config?.moneda_base ?? "ARS";
  const toLocal = (amount: number, mon: string, tasa: number) =>
    mon === base ? amount : amount * (tasa || 1);

  const sumIngresos = ingresosMes.reduce((s, x) => s + toLocal(Number(x.monto), x.moneda, Number(x.tasa_cambio || 1)), 0);
  const sumGastos = pagosMes.reduce((s, g) => s + toLocal(Number(g.total), g.moneda, Number(g.tasa_cambio || 1)), 0);
  const sumNotas = notasMes.reduce((s, x) => s + toLocal(Number(x.monto), x.moneda, Number(x.tasa_cambio || 1)), 0);
  const balance = sumIngresos - sumGastos;

  // Mes anterior para variación
  const prev = monthRange(shiftMonth(todayISO(), -1));
  const prevIngresos = (ingresos ?? []).filter(r => r.fecha >= prev.start && r.fecha <= prev.end);
  const prevPagos = (pagosDB ?? []).filter(r => r.fecha >= prev.start && r.fecha <= prev.end);
  const prevSumIngresos = prevIngresos.reduce((s, x) => s + toLocal(Number(x.monto), x.moneda, Number(x.tasa_cambio || 1)), 0);
  const prevSumGastos = prevPagos.reduce((s, g) => s + toLocal(Number(g.total), g.moneda, Number(g.tasa_cambio || 1)), 0);
  const prevBalance = prevSumIngresos - prevSumGastos;

  function pctChange(curr: number, before: number): number | null {
    if (before === 0) return null;
    return ((curr - before) / Math.abs(before)) * 100;
  }

  const pendientes = (facturasDB ?? []).filter(
    (g) => g.estado === "pendiente" || g.estado === "parcial"
  );
  const pendientesMonto = pendientes.reduce(
    (s, g) => s + toLocal(Number(g.total) - Number(g.monto_pagado), g.moneda, Number(g.tasa_cambio || 1)), 0
  );

  const kpis = [
    { label: "Ingresos del mes", value: sumIngresos, prev: prevSumIngresos, icon: TrendingUp, color: "text-green-600", bg: "bg-green-50", upGood: true },
    { label: "Gastos del mes", value: sumGastos, prev: prevSumGastos, icon: TrendingDown, color: "text-red-600", bg: "bg-red-50", upGood: false },
    { label: "Balance del mes", value: balance, prev: prevBalance, icon: Wallet, color: balance >= 0 ? "text-teal-600" : "text-red-600", bg: balance >= 0 ? "bg-teal-50" : "bg-red-50", upGood: true },
    { label: "Por pagar", value: pendientesMonto, prev: undefined, icon: FileMinus, color: "text-amber-600", bg: "bg-amber-50", upGood: false },
  ];

  // ── Serie mensual: últimos 6 meses ─────────────────────────────────────
  const monthlyData = useMemo(() => {
    const months: { iso: string; ingresos: number; egresos: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const monthStart = shiftMonth(todayISO(), -i);
      const r = monthRange(monthStart);
      const ing = (ingresos ?? [])
        .filter(x => x.fecha >= r.start && x.fecha <= r.end)
        .reduce((s, x) => s + toLocal(Number(x.monto), x.moneda, Number(x.tasa_cambio || 1)), 0);
      const eg = (pagosDB ?? [])
        .filter(g => g.fecha >= r.start && g.fecha <= r.end)
        .reduce((s, g) => s + toLocal(Number(g.total), g.moneda, Number(g.tasa_cambio || 1)), 0);
      months.push({ iso: monthStart, ingresos: ing, egresos: eg });
    }
    return months;
  }, [ingresos, pagosDB, base]);

  // Rango: últimos 90 días para top proveedores
  const since90 = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  const recentIngresos = [...ingresosMes].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 5);
  const recentGastos = [...pagosMes].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 5);

  return (
    <>
      <PageHeader
        title={`Hola, ${config?.empresa_nombre ?? ""}`}
        description={`Resumen de ${new Date().toLocaleDateString(country.locale, { month: "long", year: "numeric" })} (moneda base ${base})`}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {kpis.map((k) => {
          const Icon = k.icon;
          const variation = k.prev !== undefined ? pctChange(k.value, k.prev) : null;
          const goingUp = variation !== null && variation > 0.5;
          const goingDown = variation !== null && variation < -0.5;
          const positiveDirection =
            (k.upGood && goingUp) || (!k.upGood && goingDown);
          const negativeDirection =
            (k.upGood && goingDown) || (!k.upGood && goingUp);
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-[var(--muted)]">{k.label}</span>
                <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${k.bg}`}>
                  <Icon className={`w-4 h-4 ${k.color}`} />
                </span>
              </div>
              <div className="text-2xl font-semibold">{formatMoney(k.value, base, country.locale)}</div>
              {variation !== null && (
                <div className="flex items-center gap-1 mt-1.5 text-xs">
                  <span
                    className={`inline-flex items-center gap-0.5 font-medium ${
                      positiveDirection
                        ? "text-emerald-600"
                        : negativeDirection
                        ? "text-red-600"
                        : "text-slate-400"
                    }`}
                  >
                    {goingUp ? (
                      <ArrowUp className="w-3 h-3" />
                    ) : goingDown ? (
                      <ArrowDown className="w-3 h-3" />
                    ) : (
                      <Minus className="w-3 h-3" />
                    )}
                    {Math.abs(variation).toFixed(1)}%
                  </span>
                  <span className="text-slate-400">vs. mes anterior</span>
                </div>
              )}
              {k.prev === undefined && (
                <div className="text-xs text-slate-400 mt-1.5">
                  {k.label === "Por pagar" ? `${pendientes.length} factura${pendientes.length !== 1 ? "s" : ""}` : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Gráfico mensual */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[var(--primary)]" />
            <h3 className="font-semibold text-sm">Últimos 6 meses</h3>
          </div>
          <span className="text-xs text-slate-400">
            En {base}
          </span>
        </div>
        <MonthlyBarChart
          monthLabels={monthlyData.map(m => monthName(m.iso, country.locale))}
          series={[
            { label: "Ingresos", color: "#10b981", values: monthlyData.map(m => m.ingresos) },
            { label: "Egresos", color: "#ef4444", values: monthlyData.map(m => m.egresos) },
          ]}
          monedaBase={base as never}
          locale={country.locale}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <RecentList
          title="Últimos ingresos"
          href="/ingresos/pagos-recibidos"
          empty="Aún no hay ingresos registrados este mes."
          rows={recentIngresos.map((i) => ({
            id: i.id, label: `#${i.id}`, sublabel: i.concepto,
            amount: Number(i.monto), currency: i.moneda, date: i.fecha, positive: true,
          }))}
          locale={country.locale}
        />
        <RecentList
          title="Últimos pagos"
          href="/egresos/pagos"
          empty="Aún no hay pagos registrados este mes."
          rows={recentGastos.map((g) => ({
            id: g.id,
            label: `#${g.id}`,
            sublabel: g.concepto,
            amount: Number(g.total), currency: g.moneda, date: g.fecha, positive: false,
          }))}
          locale={country.locale}
        />
      </div>

      {/* Flujo de caja proyectado */}
      <div className="mb-6">
        <CashFlowForecast
          facturas={facturasDB ?? []}
          monedaBase={base as never}
          locale={country.locale}
        />
      </div>

      <div className="mb-6">
        <PaymentCalendar
          facturas={facturasDB ?? []}
          contactos={contactos ?? []}
          monedaBase={base as never}
          locale={country.locale}
        />
      </div>

      {/* Top proveedores últimos 90 días */}
      <div className="mb-6">
        <TopProveedores
          pagos={pagosDB ?? []}
          facturas={facturasDB ?? []}
          contactos={contactos ?? []}
          monedaBase={base as never}
          locale={country.locale}
          startDate={since90}
          title="Top proveedores (últimos 90 días)"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={<Users className="w-5 h-5" />} label="Contactos" value={contactos?.length ?? 0} href="/contactos" />
        <StatCard
          icon={<FileMinus className="w-5 h-5" />}
          label="Notas de crédito (mes)"
          value={notasMes.length}
          href="/ingresos/notas-credito"
          extra={sumNotas > 0 ? formatMoney(sumNotas, base, country.locale) : undefined}
        />
        <StatCard icon={<TrendingDown className="w-5 h-5" />} label="Facturas pendientes" value={pendientes.length} href="/egresos/facturas" />
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
