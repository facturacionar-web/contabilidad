"use client";
import { useMemo } from "react";
import Link from "next/link";
import type { Gasto } from "@/lib/types";
import type { CurrencyCode } from "@/lib/countries";
import { formatMoney } from "@/lib/format";
import { TrendingUp, TrendingDown, Wallet, AlertCircle, ArrowRight } from "lucide-react";

type Liquidacion = { fecha: string; monto: number | string; cantidad: number };

type Props = {
  facturas: Gasto[];                  // tipo === "factura_proveedor"
  liquidaciones?: Liquidacion[];      // ingresos proyectados (MP) por fecha
  pagosUltimos90?: Gasto[];           // tipo === "gasto" para estimar promedio diario
  saldoActual?: number;               // saldo en cuentas (opcional)
  monedaBase: CurrencyCode;
  locale: string;
  diasProyeccion?: number;            // default 30
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export default function CashFlowForecast({
  facturas,
  liquidaciones = [],
  monedaBase,
  locale,
  diasProyeccion = 30,
}: Props) {
  const today = todayISO();
  const limite = addDays(today, diasProyeccion);

  // Agrupar vencimientos pendientes (egresos) + liquidaciones MP (ingresos) por semana
  const buckets = useMemo(() => {
    type Bucket = {
      from: string;
      to: string;
      label: string;
      total: number;     // egresos
      count: number;
      cobros: number;    // ingresos proyectados
      cobrosCount: number;
    };
    const ranges = [
      { from: today, to: addDays(today, 7), label: "Próximos 7 días" },
      { from: addDays(today, 8), to: addDays(today, 14), label: "Días 8–14" },
      { from: addDays(today, 15), to: addDays(today, 21), label: "Días 15–21" },
      { from: addDays(today, 22), to: limite, label: "Días 22–30" },
    ];
    const result: Bucket[] = ranges.map(r => ({ ...r, total: 0, count: 0, cobros: 0, cobrosCount: 0 }));

    for (const f of facturas) {
      if (!(f.estado === "pendiente" || f.estado === "parcial")) continue;
      if (!f.fecha_vencimiento) continue;
      const v = f.fecha_vencimiento;
      if (v > limite) continue;
      const tasa = Number(f.tasa_cambio || 1);
      const pendiente = Number(f.total) - Number(f.monto_pagado);
      const enBase = f.moneda === monedaBase ? pendiente : pendiente * tasa;
      // Vencidas → primer bucket (al frente como deuda inmediata)
      if (v < today) {
        result[0].total += enBase;
        result[0].count += 1;
        continue;
      }
      for (const b of result) {
        if (v >= b.from && v <= b.to) {
          b.total += enBase;
          b.count += 1;
          break;
        }
      }
    }

    for (const l of liquidaciones) {
      if (!l.fecha) continue;
      if (l.fecha < today || l.fecha > limite) continue;  // proyección solo hacia adelante
      const monto = Number(l.monto);
      for (const b of result) {
        if (l.fecha >= b.from && l.fecha <= b.to) {
          b.cobros += monto;
          b.cobrosCount += l.cantidad;
          break;
        }
      }
    }
    return result;
  }, [facturas, liquidaciones, today, limite, monedaBase]);

  // Vencidas como métrica separada
  const vencidas = useMemo(() => {
    let total = 0;
    let count = 0;
    for (const f of facturas) {
      if (!(f.estado === "pendiente" || f.estado === "parcial")) continue;
      if (!f.fecha_vencimiento || f.fecha_vencimiento >= today) continue;
      const tasa = Number(f.tasa_cambio || 1);
      const pendiente = Number(f.total) - Number(f.monto_pagado);
      total += f.moneda === monedaBase ? pendiente : pendiente * tasa;
      count += 1;
    }
    return { total, count };
  }, [facturas, today, monedaBase]);

  const totalProyectado = buckets.reduce((s, b) => s + b.total, 0);
  const totalCobros = buckets.reduce((s, b) => s + b.cobros, 0);
  const totalCobrosCount = buckets.reduce((s, b) => s + b.cobrosCount, 0);
  const neto = totalCobros - totalProyectado;
  const max = Math.max(...buckets.map(b => Math.max(b.total, b.cobros)), 1);

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-[var(--primary)]" />
          <h3 className="font-semibold text-sm">Flujo de caja proyectado</h3>
          <span className="text-xs text-slate-400">
            (próximos {diasProyeccion} días)
          </span>
        </div>
        <Link href="/egresos/facturas" className="text-xs text-[var(--primary)] hover:underline flex items-center gap-1">
          Ver facturas <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="p-5">
        {/* Resumen total */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <div className="bg-red-50 border border-red-100 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-600" />
              <p className="text-xs text-slate-500 uppercase tracking-wide">A pagar</p>
            </div>
            <p className="text-xl font-bold text-red-600 mt-1">
              {formatMoney(totalProyectado, monedaBase, locale)}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {buckets.reduce((s, b) => s + b.count, 0)} factura{buckets.reduce((s, b) => s + b.count, 0) !== 1 ? "s" : ""} en {diasProyeccion} días
            </p>
          </div>

          <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <p className="text-xs text-slate-500 uppercase tracking-wide">A cobrar</p>
            </div>
            <p className="text-xl font-bold text-emerald-600 mt-1">
              {formatMoney(totalCobros, monedaBase, locale)}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {totalCobrosCount} liquidacion{totalCobrosCount !== 1 ? "es" : ""} MP
            </p>
          </div>

          <div className={`border rounded-lg p-3 ${neto >= 0 ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"}`}>
            <div className="flex items-center gap-2">
              <Wallet className={`w-4 h-4 ${neto >= 0 ? "text-emerald-600" : "text-red-600"}`} />
              <p className="text-xs text-slate-500 uppercase tracking-wide">Neto proyectado</p>
            </div>
            <p className={`text-xl font-bold mt-1 ${neto >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {neto >= 0 ? "+" : ""}{formatMoney(neto, monedaBase, locale)}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              cobros − pagos en {diasProyeccion} días
            </p>
          </div>

          <div className={`border rounded-lg p-3 ${vencidas.count > 0 ? "bg-red-100 border-red-300" : "bg-slate-50 border-slate-100"}`}>
            <div className="flex items-center gap-2">
              {vencidas.count > 0 ? (
                <AlertCircle className="w-4 h-4 text-red-700" />
              ) : (
                <TrendingUp className="w-4 h-4 text-slate-400" />
              )}
              <p className="text-xs text-slate-500 uppercase tracking-wide">
                {vencidas.count > 0 ? "Ya vencidas" : "Sin vencidas"}
              </p>
            </div>
            <p className={`text-xl font-bold mt-1 ${vencidas.count > 0 ? "text-red-700" : "text-slate-500"}`}>
              {formatMoney(vencidas.total, monedaBase, locale)}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {vencidas.count > 0 ? `${vencidas.count} sin pagar` : "Al día"}
            </p>
          </div>
        </div>

        {/* Distribución por semana: 2 barras por bucket (cobros + pagos) */}
        <div className="space-y-3">
          <p className="text-xs font-medium text-slate-500 mb-2">Distribución por semana</p>
          {buckets.map((b) => (
            <div key={b.label} className="grid grid-cols-[120px_1fr_140px_50px] gap-3 items-center">
              <span className="text-xs text-slate-500">{b.label}</span>
              <div className="space-y-1">
                <div className="h-3 bg-slate-100 rounded-md overflow-hidden relative">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-md transition-all"
                    style={{ width: `${(b.cobros / max) * 100}%` }}
                    title={`Cobros: ${formatMoney(b.cobros, monedaBase, locale)}`}
                  />
                </div>
                <div className="h-3 bg-slate-100 rounded-md overflow-hidden relative">
                  <div
                    className="h-full bg-gradient-to-r from-amber-400 to-red-500 rounded-md transition-all"
                    style={{ width: `${(b.total / max) * 100}%` }}
                    title={`Pagos: ${formatMoney(b.total, monedaBase, locale)}`}
                  />
                </div>
              </div>
              <div className="text-right space-y-0.5">
                {b.cobros > 0 && (
                  <div className="text-xs font-semibold text-emerald-600">+{formatMoney(b.cobros, monedaBase, locale)}</div>
                )}
                {b.total > 0 && (
                  <div className="text-xs font-semibold text-red-500">−{formatMoney(b.total, monedaBase, locale)}</div>
                )}
                {b.total === 0 && b.cobros === 0 && (
                  <div className="text-xs text-slate-400">—</div>
                )}
              </div>
              <div className="text-[10px] text-slate-400 text-right leading-tight">
                {b.cobrosCount > 0 && <div className="text-emerald-500">{b.cobrosCount} liq.</div>}
                {b.count > 0 && <div>{b.count} fact.</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
