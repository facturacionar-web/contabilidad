"use client";
import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useTable, paisFilter } from "@/lib/useSupabaseData";
import type { Ingreso, Gasto, Cuenta } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import { formatMoney, formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import AccountBalanceChart, { type BalancePoint } from "@/components/AccountBalanceChart";
import MonthlyBarChart from "@/components/MonthlyBarChart";
import { ArrowLeft, TrendingUp, TrendingDown, Wallet, ArrowUpRight, ArrowDownRight, Loader2 } from "lucide-react";

const TIPO_LABELS: Record<string, string> = {
  banco: "Banco",
  billetera: "Billetera virtual",
  efectivo: "Efectivo",
  otro: "Otro",
};
const TIPO_ICONS: Record<string, string> = {
  banco: "🏦",
  billetera: "💳",
  efectivo: "💵",
  otro: "🗂️",
};

type Movimiento = {
  id: number;
  fecha: string;
  concepto: string;
  monto: number;          // siempre positivo
  tipo: "ingreso" | "gasto";
  metodo?: string | null;
  referencia?: string | null;
};

export default function CuentaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { config, country } = useConfig();
  const pais = config?.pais;

  const { data: cuentas } = useTable("cuentas", {
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });
  const { data: ingresos, loading: loadIng } = useTable("ingresos", {
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });
  const { data: gastos, loading: loadGas } = useTable("gastos", {
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });

  const cuenta: Cuenta | undefined = (cuentas ?? []).find((c) => c.id === id);

  // Movimientos de la cuenta ordenados por fecha asc + id como tiebreaker
  const movimientos: Movimiento[] = useMemo(() => {
    const ings: Movimiento[] = (ingresos ?? [])
      .filter((i: Ingreso) => i.cuenta_id === id)
      .map((i: Ingreso) => ({
        id: i.id,
        fecha: i.fecha,
        concepto: i.concepto,
        monto: Number(i.monto),
        tipo: "ingreso",
        metodo: i.metodo_pago,
        referencia: i.referencia,
      }));
    const gas: Movimiento[] = (gastos ?? [])
      .filter((g: Gasto) => g.cuenta_id === id)
      .map((g: Gasto) => ({
        id: g.id,
        fecha: g.fecha,
        concepto: g.concepto,
        monto: Number(g.total),
        tipo: "gasto",
        metodo: g.metodo_pago,
        referencia: g.numero_factura,
      }));
    return [...ings, ...gas].sort((a, b) => {
      if (a.fecha !== b.fecha) return a.fecha.localeCompare(b.fecha);
      return a.id - b.id;
    });
  }, [ingresos, gastos, id]);

  // Saldo acumulado después de CADA movimiento (orden cronológico asc)
  const acumuladoPorMov = useMemo(() => {
    const map = new Map<string, number>();
    let acc = 0;
    for (const m of movimientos) {
      acc += m.tipo === "ingreso" ? m.monto : -m.monto;
      map.set(`${m.tipo}-${m.id}`, acc);
    }
    return map;
  }, [movimientos]);

  // Saldo acumulado al cierre de cada día con movimiento
  const balancePoints: BalancePoint[] = useMemo(() => {
    const map = new Map<string, number>(); // fecha → delta del día
    for (const m of movimientos) {
      const delta = m.tipo === "ingreso" ? m.monto : -m.monto;
      map.set(m.fecha, (map.get(m.fecha) ?? 0) + delta);
    }
    const fechas = Array.from(map.keys()).sort();
    let acc = 0;
    return fechas.map((fecha) => {
      acc += map.get(fecha) ?? 0;
      return { fecha, saldo: acc };
    });
  }, [movimientos]);

  const saldoActual = balancePoints.length > 0 ? balancePoints[balancePoints.length - 1].saldo : 0;

  // KPIs últimos 30 días
  const kpis = useMemo(() => {
    const today = new Date();
    const limite = new Date(today);
    limite.setDate(limite.getDate() - 30);
    const limiteIso = limite.toISOString().slice(0, 10);
    let ingresos30 = 0, gastos30 = 0;
    let ingCount = 0, gasCount = 0;
    for (const m of movimientos) {
      if (m.fecha < limiteIso) continue;
      if (m.tipo === "ingreso") { ingresos30 += m.monto; ingCount++; }
      else { gastos30 += m.monto; gasCount++; }
    }
    return { ingresos30, gastos30, ingCount, gasCount, neto30: ingresos30 - gastos30 };
  }, [movimientos]);

  // Serie mensual: últimos 6 meses (ingresos vs gastos)
  const monthlyData = useMemo(() => {
    const today = new Date();
    const months: { label: string; iso: string; ingresos: number; gastos: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months.push({
        label: d.toLocaleDateString(country.locale, { month: "short" }),
        iso, ingresos: 0, gastos: 0,
      });
    }
    for (const m of movimientos) {
      const ymKey = m.fecha.slice(0, 7);
      const month = months.find((mo) => mo.iso === ymKey);
      if (!month) continue;
      if (m.tipo === "ingreso") month.ingresos += m.monto;
      else month.gastos += m.monto;
    }
    return months;
  }, [movimientos, country.locale]);

  if (!cuenta && (cuentas !== undefined)) {
    return (
      <>
        <PageHeader title="Cuenta no encontrada" description="" />
        <Link href="/cuentas" className="btn btn-secondary inline-flex">
          <ArrowLeft className="w-4 h-4" /> Volver
        </Link>
      </>
    );
  }

  if (!cuenta) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--muted)]" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={`${TIPO_ICONS[cuenta.tipo]}  ${cuenta.nombre}`}
        description={`${TIPO_LABELS[cuenta.tipo]} · ${cuenta.moneda}${cuenta.descripcion ? ` · ${cuenta.descripcion}` : ""}`}
        action={
          <Link href="/cuentas" className="btn btn-secondary">
            <ArrowLeft className="w-4 h-4" /> Volver
          </Link>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[var(--muted)]">Saldo estimado</span>
            <span className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Wallet className={`w-4 h-4 ${saldoActual >= 0 ? "text-emerald-400" : "text-red-500"}`} />
            </span>
          </div>
          <p className={`text-2xl font-semibold ${saldoActual >= 0 ? "text-emerald-400" : "text-red-500"}`}>
            {formatMoney(saldoActual, cuenta.moneda, country.locale)}
          </p>
          <p className="text-xs text-[var(--muted)] mt-1.5">{movimientos.length} movimientos totales</p>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[var(--muted)]">Ingresos 30d</span>
            <span className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <ArrowUpRight className="w-4 h-4 text-emerald-400" />
            </span>
          </div>
          <p className="text-2xl font-semibold text-emerald-400">
            +{formatMoney(kpis.ingresos30, cuenta.moneda, country.locale)}
          </p>
          <p className="text-xs text-[var(--muted)] mt-1.5">{kpis.ingCount} movimientos</p>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[var(--muted)]">Gastos 30d</span>
            <span className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center">
              <ArrowDownRight className="w-4 h-4 text-red-500" />
            </span>
          </div>
          <p className="text-2xl font-semibold text-red-500">
            −{formatMoney(kpis.gastos30, cuenta.moneda, country.locale)}
          </p>
          <p className="text-xs text-[var(--muted)] mt-1.5">{kpis.gasCount} movimientos</p>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[var(--muted)]">Neto 30d</span>
            <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${kpis.neto30 >= 0 ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
              {kpis.neto30 >= 0
                ? <TrendingUp className="w-4 h-4 text-emerald-400" />
                : <TrendingDown className="w-4 h-4 text-red-500" />}
            </span>
          </div>
          <p className={`text-2xl font-semibold ${kpis.neto30 >= 0 ? "text-emerald-400" : "text-red-500"}`}>
            {kpis.neto30 >= 0 ? "+" : ""}{formatMoney(kpis.neto30, cuenta.moneda, country.locale)}
          </p>
          <p className="text-xs text-[var(--muted)] mt-1.5">últimos 30 días</p>
        </div>
      </div>

      {/* Gráfico de saldo histórico */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Saldo histórico</h3>
          <span className="text-xs text-[var(--muted)]">{balancePoints.length} días con movimiento</span>
        </div>
        {(loadIng || loadGas) ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--muted)]" />
          </div>
        ) : (
          <AccountBalanceChart
            points={balancePoints}
            moneda={cuenta.moneda}
            locale={country.locale}
            color={saldoActual >= 0 ? "#10b981" : "#ef4444"}
          />
        )}
      </div>

      {/* Gráfico mensual: ingresos vs gastos últimos 6 meses */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Últimos 6 meses</h3>
          <span className="text-xs text-[var(--muted)]">En {cuenta.moneda}</span>
        </div>
        <MonthlyBarChart
          monthLabels={monthlyData.map((m) => m.label)}
          series={[
            { label: "Ingresos", color: "#10b981", values: monthlyData.map((m) => m.ingresos) },
            { label: "Gastos", color: "#ef4444", values: monthlyData.map((m) => m.gastos) },
          ]}
          monedaBase={cuenta.moneda}
          locale={country.locale}
        />
      </div>

      {/* Tabla de movimientos (más recientes primero) */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h3 className="font-semibold">Movimientos</h3>
          <span className="text-xs text-[var(--muted)]">{movimientos.length} totales</span>
        </div>
        {movimientos.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-[var(--muted)]">
            Aún no hay movimientos en esta cuenta.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th>Método</th>
                <th>Referencia</th>
                <th className="text-right">Monto</th>
                <th className="text-right">Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {[...movimientos].reverse().slice(0, 50).map((m) => {
                const acumulado = acumuladoPorMov.get(`${m.tipo}-${m.id}`) ?? 0;
                return (
                  <tr key={`${m.tipo}-${m.id}`}>
                    <td className="whitespace-nowrap">{formatDate(m.fecha, country.locale)}</td>
                    <td className="font-medium max-w-xs truncate">{m.concepto}</td>
                    <td className="text-[var(--muted)]">{m.metodo ?? "—"}</td>
                    <td className="text-[var(--muted)] font-mono text-xs">{m.referencia ?? "—"}</td>
                    <td className={`text-right font-semibold whitespace-nowrap ${m.tipo === "ingreso" ? "text-emerald-400" : "text-red-500"}`}>
                      {m.tipo === "ingreso" ? "+" : "−"}{formatMoney(m.monto, cuenta.moneda, country.locale)}
                    </td>
                    <td className={`text-right font-medium whitespace-nowrap ${acumulado >= 0 ? "text-emerald-400/80" : "text-red-500/80"}`}>
                      {formatMoney(acumulado, cuenta.moneda, country.locale)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {movimientos.length > 50 && (
          <div className="px-5 py-3 text-center text-xs text-[var(--muted)] border-t border-[var(--border)]">
            Mostrando los 50 más recientes de {movimientos.length}.
          </div>
        )}
      </div>
    </>
  );
}
