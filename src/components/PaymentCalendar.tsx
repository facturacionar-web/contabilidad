"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, AlertCircle, X, CalendarDays, ExternalLink } from "lucide-react";
import type { Gasto, Contacto } from "@/lib/types";
import type { CurrencyCode } from "@/lib/countries";
import { formatMoney } from "@/lib/format";

type Liquidacion = { fecha: string; monto: number | string; cantidad: number };

type Props = {
  facturas: Gasto[];
  contactos: Contacto[];
  monedaBase: CurrencyCode;
  locale: string;
  liquidaciones?: Liquidacion[];   // ingresos proyectados (MP) por fecha
};

const DAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTH_LABELS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function pad(n: number) { return String(n).padStart(2, "0"); }
function ymd(y: number, m: number, d: number) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}
function todayLocalISO(): string {
  const d = new Date();
  return ymd(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Formato compacto para celdas: $1,2M / $250K / $1.500 */
function formatCompact(amount: number, currency: CurrencyCode): string {
  const sym = currency === "USD" ? "US$" : currency === "EUR" ? "€" : "$";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${sym}${(amount / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (abs >= 10_000) return `${sym}${Math.round(amount / 1000)}K`;
  if (abs >= 1_000) return `${sym}${(amount / 1000).toFixed(1).replace(".", ",")}K`;
  return `${sym}${Math.round(amount)}`;
}

export default function PaymentCalendar({ facturas, contactos, monedaBase, locale, liquidaciones = [] }: Props) {
  const today = todayLocalISO();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const contactoMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of contactos) m.set(c.id, c.nombre);
    return m;
  }, [contactos]);

  const pendientes = useMemo(() => {
    return (facturas ?? []).filter(
      (f) =>
        (f.estado === "pendiente" || f.estado === "parcial") &&
        !!f.fecha_vencimiento
    );
  }, [facturas]);

  const porFecha = useMemo(() => {
    const map = new Map<string, Gasto[]>();
    for (const f of pendientes) {
      const k = f.fecha_vencimiento as string;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(f);
    }
    return map;
  }, [pendientes]);

  // Liquidaciones MP futuras (ingresos proyectados) por fecha
  const liquidacionPorFecha = useMemo(() => {
    const map = new Map<string, { monto: number; cantidad: number }>();
    for (const l of liquidaciones) {
      const monto = Number(l.monto);
      const existing = map.get(l.fecha);
      if (existing) {
        existing.monto += monto;
        existing.cantidad += l.cantidad;
      } else {
        map.set(l.fecha, { monto, cantidad: l.cantidad });
      }
    }
    return map;
  }, [liquidaciones]);

  const totalEnBase = (rows: Gasto[]) =>
    rows.reduce((s, g) => {
      const pendiente = Number(g.total) - Number(g.monto_pagado);
      const tasa = Number(g.tasa_cambio || 1);
      return s + (g.moneda === monedaBase ? pendiente : pendiente * tasa);
    }, 0);

  const grid = useMemo(() => {
    const firstOfMonth = new Date(year, month, 1);
    const lastOfMonth = new Date(year, month + 1, 0);
    const startWeekday = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = lastOfMonth.getDate();

    const cells: { date: string; day: number; inMonth: boolean }[] = [];

    if (startWeekday > 0) {
      const prevLast = new Date(year, month, 0).getDate();
      for (let i = startWeekday - 1; i >= 0; i--) {
        const d = prevLast - i;
        const y = month === 0 ? year - 1 : year;
        const m = month === 0 ? 11 : month - 1;
        cells.push({ date: ymd(y, m, d), day: d, inMonth: false });
      }
    }

    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: ymd(year, month, d), day: d, inMonth: true });
    }

    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1];
      const [ly, lm, ld] = last.date.split("-").map(Number);
      const next = new Date(ly, lm - 1, ld + 1);
      cells.push({
        date: ymd(next.getFullYear(), next.getMonth(), next.getDate()),
        day: next.getDate(),
        inMonth: false,
      });
    }

    return cells;
  }, [year, month]);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }
  function goToday() {
    const d = new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setSelectedDate(today);
  }

  const totalMes = useMemo(() => {
    const start = ymd(year, month, 1);
    const endY = month === 11 ? year + 1 : year;
    const endM = month === 11 ? 0 : month + 1;
    const end = ymd(endY, endM, 1);
    const rows = pendientes.filter(f => {
      const v = f.fecha_vencimiento!;
      return v >= start && v < end;
    });
    return { count: rows.length, total: totalEnBase(rows) };
  }, [pendientes, year, month, monedaBase]);

  // Total a cobrar (liquidaciones MP) del mes mostrado
  const totalCobrarMes = useMemo(() => {
    const start = ymd(year, month, 1);
    const endY = month === 11 ? year + 1 : year;
    const endM = month === 11 ? 0 : month + 1;
    const end = ymd(endY, endM, 1);
    let total = 0, count = 0;
    for (const [fecha, info] of liquidacionPorFecha) {
      if (fecha >= start && fecha < end) {
        total += info.monto;
        count += info.cantidad;
      }
    }
    return { total, count };
  }, [liquidacionPorFecha, year, month]);

  const vencidas = useMemo(
    () => pendientes.filter(f => (f.fecha_vencimiento as string) < today),
    [pendientes, today]
  );
  const vencidasTotal = totalEnBase(vencidas);

  const proximas7 = useMemo(() => {
    const max = new Date();
    max.setDate(max.getDate() + 7);
    const maxStr = ymd(max.getFullYear(), max.getMonth(), max.getDate());
    return pendientes.filter(f => {
      const v = f.fecha_vencimiento!;
      return v >= today && v <= maxStr;
    });
  }, [pendientes, today]);
  const proximas7Total = totalEnBase(proximas7);

  const selectedRows = selectedDate ? (porFecha.get(selectedDate) ?? []) : [];
  const selectedLiq = selectedDate ? liquidacionPorFecha.get(selectedDate) : undefined;
  const hasSelectedInfo = !!selectedDate && (selectedRows.length > 0 || (selectedLiq && selectedLiq.monto > 0));

  // Encontrar el monto máximo del mes para escalar la "intensidad" del color
  const maxDayTotal = useMemo(() => {
    let max = 0;
    for (const cell of grid) {
      if (!cell.inMonth) continue;
      const rows = porFecha.get(cell.date);
      if (rows) {
        const t = totalEnBase(rows);
        if (t > max) max = t;
      }
    }
    return max;
  }, [grid, porFecha, monedaBase]);

  return (
    <div className="bg-white rounded-2xl border border-[var(--border)] shadow-sm overflow-hidden">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="px-6 py-5 bg-gradient-to-br from-[var(--primary)] to-[var(--primary-hover)] text-white">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
              <CalendarDays className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-lg leading-tight">Calendario de vencimientos</h3>
              <p className="text-xs text-white/80 mt-0.5">
                Pagos pendientes según fecha de vencimiento
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-white/15 backdrop-blur rounded-xl p-1">
            <button
              onClick={prevMonth}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/20 transition-colors"
              aria-label="Mes anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={goToday}
              className="px-3 h-8 text-xs font-semibold hover:bg-white/20 rounded-lg transition-colors"
            >
              Hoy
            </button>
            <button
              onClick={nextMonth}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/20 transition-colors"
              aria-label="Mes siguiente"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stat strip */}
        <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white/10 backdrop-blur rounded-xl p-3">
            <p className="text-[11px] uppercase tracking-wide text-white/70 font-medium">
              A pagar {MONTH_LABELS[month]}
            </p>
            <p className="text-xl font-bold mt-0.5">
              {formatMoney(totalMes.total, monedaBase, locale)}
            </p>
            <p className="text-[11px] text-white/70 mt-0.5">
              {totalMes.count} vencimiento{totalMes.count !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="bg-emerald-400/20 backdrop-blur rounded-xl p-3 ring-1 ring-emerald-300/30">
            <p className="text-[11px] uppercase tracking-wide text-white/70 font-medium">
              A cobrar {MONTH_LABELS[month]}
            </p>
            <p className="text-xl font-bold mt-0.5">
              {formatMoney(totalCobrarMes.total, monedaBase, locale)}
            </p>
            <p className="text-[11px] text-white/70 mt-0.5">
              {totalCobrarMes.count} liquidacion{totalCobrarMes.count !== 1 ? "es" : ""} MP
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-xl p-3">
            <p className="text-[11px] uppercase tracking-wide text-white/70 font-medium">
              Próximos 7 días
            </p>
            <p className="text-xl font-bold mt-0.5">
              {formatMoney(proximas7Total, monedaBase, locale)}
            </p>
            <p className="text-[11px] text-white/70 mt-0.5">
              {proximas7.length} factura{proximas7.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className={`backdrop-blur rounded-xl p-3 ${vencidas.length > 0 ? "bg-red-500/30 ring-1 ring-red-300/40" : "bg-white/10"}`}>
            <p className="text-[11px] uppercase tracking-wide text-white/70 font-medium flex items-center gap-1">
              {vencidas.length > 0 && <AlertCircle className="w-3 h-3" />}
              Vencidas
            </p>
            <p className="text-xl font-bold mt-0.5">
              {formatMoney(vencidasTotal, monedaBase, locale)}
            </p>
            <p className="text-[11px] text-white/70 mt-0.5">
              {vencidas.length} factura{vencidas.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* ── Día headers ─────────────────────────────────────── */}
      <div className="grid grid-cols-7 bg-slate-50 border-b border-[var(--border)]">
        {DAY_LABELS.map((d, i) => (
          <div
            key={d}
            className={`px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide ${
              i >= 5 ? "text-slate-400" : "text-slate-500"
            }`}
          >
            {d}
          </div>
        ))}
      </div>

      {/* ── Grilla calendario ───────────────────────────────── */}
      <div className="grid grid-cols-7">
        {grid.map((cell) => {
          const rows = porFecha.get(cell.date);
          const totalDay = rows ? totalEnBase(rows) : 0;
          const liqInfo = liquidacionPorFecha.get(cell.date);
          const hasLiquidacion = !!liqInfo && liqInfo.monto > 0;
          const isToday = cell.date === today;
          const isPast = cell.date < today;
          const isSelected = cell.date === selectedDate;
          const hasPending = !!rows && rows.length > 0;
          const hasAny = hasPending || hasLiquidacion;
          const isOverdue = hasPending && isPast && !isToday;
          const isWeekend = (() => {
            const [y, m, d] = cell.date.split("-").map(Number);
            const w = new Date(y, m - 1, d).getDay();
            return w === 0 || w === 6;
          })();

          // Intensidad relativa del monto del día (para tonalidad)
          const intensity = hasPending && maxDayTotal > 0
            ? Math.min(1, totalDay / maxDayTotal)
            : 0;

          // Colores según estado
          let bgClass = "bg-white";
          let amountClass = "text-slate-700";
          let badgeClass = "bg-slate-100 text-slate-600";

          if (!cell.inMonth) {
            bgClass = "bg-slate-50/40";
          } else if (isOverdue) {
            // Tonos de rojo según intensidad
            bgClass = intensity > 0.6
              ? "bg-red-100"
              : intensity > 0.3
              ? "bg-red-50"
              : "bg-red-50/60";
            amountClass = "text-red-700";
            badgeClass = "bg-red-500 text-white";
          } else if (hasPending) {
            // Tonos de amarillo/ámbar según intensidad
            bgClass = intensity > 0.6
              ? "bg-amber-100"
              : intensity > 0.3
              ? "bg-amber-50"
              : "bg-amber-50/60";
            amountClass = "text-amber-700";
            badgeClass = "bg-amber-500 text-white";
          } else if (hasLiquidacion) {
            // Solo ingreso proyectado: tinte verde claro
            bgClass = "bg-emerald-50/70";
          } else if (isWeekend && cell.inMonth) {
            bgClass = "bg-slate-50/30";
          }

          if (isSelected) {
            bgClass = "bg-[var(--primary-soft)] ring-2 ring-[var(--primary)] ring-inset";
            amountClass = "text-[var(--primary-hover)] font-bold";
          }

          return (
            <button
              key={cell.date}
              onClick={() => hasAny && setSelectedDate(isSelected ? null : cell.date)}
              disabled={!hasAny}
              className={`
                relative min-h-[92px] px-2.5 py-2 border-r border-b border-[var(--border)]
                text-left transition-all
                ${bgClass}
                ${hasAny ? "cursor-pointer hover:brightness-95 hover:shadow-inner" : "cursor-default"}
              `}
            >
              <div className="flex items-start justify-between mb-1.5">
                <span
                  className={`
                    inline-flex items-center justify-center text-sm font-semibold
                    ${isToday
                      ? "w-7 h-7 rounded-full bg-[var(--primary)] text-white shadow-md"
                      : ""
                    }
                    ${!cell.inMonth ? "text-slate-300" : !isToday ? "text-slate-700" : ""}
                  `}
                >
                  {cell.day}
                </span>
                {hasPending && (
                  <span
                    className={`text-[10px] font-bold min-w-[20px] h-5 px-1.5 rounded-full inline-flex items-center justify-center ${badgeClass}`}
                  >
                    {rows.length}
                  </span>
                )}
              </div>
              {hasPending && (
                <div className={`text-[12px] font-bold leading-tight ${amountClass}`}>
                  −{formatCompact(totalDay, monedaBase)}
                </div>
              )}
              {hasLiquidacion && cell.inMonth && (
                <div className="text-[12px] font-bold leading-tight text-emerald-600">
                  +{formatCompact(liqInfo!.monto, monedaBase)}
                </div>
              )}
              {hasPending && !hasLiquidacion && rows.length === 1 && cell.inMonth && (
                <div className="text-[10px] text-slate-500 mt-0.5 truncate leading-tight">
                  {rows[0].contacto_id ? contactoMap.get(rows[0].contacto_id) ?? "" : ""}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Detalle del día seleccionado ─────────────────────── */}
      {hasSelectedInfo && selectedDate && (
        <div className="border-t-2 border-[var(--primary)] bg-[var(--surface-2)]">
          <div className="px-6 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[var(--primary)] text-white flex items-center justify-center font-bold text-sm">
                {selectedDate.split("-")[2]}
              </div>
              <div>
                <p className="font-semibold text-sm text-[var(--foreground)]">
                  {(() => {
                    const [y, m, d] = selectedDate.split("-").map(Number);
                    const dt = new Date(y, m - 1, d);
                    return dt.toLocaleDateString(locale, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    });
                  })()}
                </p>
                <p className="text-xs text-[var(--muted)] flex items-center gap-2 flex-wrap">
                  {selectedRows.length > 0 && (
                    <span>
                      {selectedRows.length} factura{selectedRows.length !== 1 ? "s" : ""} ·{" "}
                      <span className="font-semibold text-red-500">
                        −{formatMoney(totalEnBase(selectedRows), monedaBase, locale)}
                      </span>
                    </span>
                  )}
                  {selectedLiq && selectedLiq.monto > 0 && (
                    <span>
                      {selectedLiq.cantidad} liquidación{selectedLiq.cantidad !== 1 ? "es" : ""} MP ·{" "}
                      <span className="font-semibold text-emerald-600">
                        +{formatMoney(selectedLiq.monto, monedaBase, locale)}
                      </span>
                    </span>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={() => setSelectedDate(null)}
              className="text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)] p-1.5 rounded-lg transition-colors"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <ul className="divide-y divide-[var(--border)] bg-[var(--card)] mx-3 mb-3 rounded-xl border border-[var(--border)] overflow-hidden">
            {selectedRows.map((g) => {
              const pendiente = Number(g.total) - Number(g.monto_pagado);
              const proveedor = g.contacto_id ? contactoMap.get(g.contacto_id) : null;
              const isOverdue = (g.fecha_vencimiento as string) < today;
              return (
                <li key={g.id} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-[var(--surface-hover)] transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-[var(--foreground)] truncate">
                        {proveedor ?? "—"}
                      </p>
                      {g.numero_factura && (
                        <span className="text-[11px] text-[var(--muted)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded font-mono">
                          {g.numero_factura}
                        </span>
                      )}
                      {g.estado === "parcial" && (
                        <span className="text-[10px] font-medium bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                          Pago parcial
                        </span>
                      )}
                      {isOverdue && (
                        <span className="text-[10px] font-medium bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                          Vencida
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--muted)] truncate mt-0.5">{g.concepto}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-bold text-red-500">
                        {formatMoney(pendiente, g.moneda, locale)}
                      </p>
                      {Number(g.monto_pagado) > 0 && (
                        <p className="text-[10px] text-[var(--muted)] opacity-70">
                          de {formatMoney(Number(g.total), g.moneda, locale)}
                        </p>
                      )}
                    </div>
                    <Link
                      href={`/egresos/pagos?factura=${g.id}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-hover)] transition-colors shadow-sm"
                    >
                      Pagar
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Leyenda ─────────────────────────────────────────── */}
      {!selectedDate && (
        <div className="px-6 py-3 bg-slate-50/50 border-t border-[var(--border)] flex items-center gap-4 text-[11px] text-slate-500 flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-200" />
            Próximo vencimiento
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-red-200" />
            Factura vencida
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-100" />
            Liquidación MP proyectada
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[var(--primary)]" />
            Hoy
          </span>
          <span className="ml-auto text-slate-400 italic">Tocá un día para ver detalles</span>
        </div>
      )}
    </div>
  );
}
