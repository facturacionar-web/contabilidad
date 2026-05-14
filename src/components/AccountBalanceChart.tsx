"use client";
import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/format";
import type { CurrencyCode } from "@/lib/countries";

export type BalancePoint = { fecha: string; saldo: number };

type Props = {
  points: BalancePoint[];
  moneda: CurrencyCode;
  locale: string;
  height?: number;
  color?: string;
};

function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1000)}K`;
  return `${sign}${Math.round(abs)}`;
}

function fmtDateShort(iso: string, locale: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
  });
}

/**
 * Gráfico de línea para saldo histórico de una cuenta.
 * Recibe puntos pre-ordenados por fecha asc.
 */
export default function AccountBalanceChart({
  points,
  moneda,
  locale,
  height = 240,
  color = "#10b981",
}: Props) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  const { min, max, range } = useMemo(() => {
    if (points.length === 0) return { min: 0, max: 1, range: 1 };
    let mn = points[0].saldo, mx = points[0].saldo;
    for (const p of points) {
      if (p.saldo < mn) mn = p.saldo;
      if (p.saldo > mx) mx = p.saldo;
    }
    // padding del 10% para que la línea no toque los bordes
    const pad = Math.max(Math.abs(mx - mn) * 0.1, 1);
    return { min: mn - pad, max: mx + pad, range: (mx - mn) + 2 * pad };
  }, [points]);

  const W = 800;
  const H = height;
  const padTop = 18;
  const padBottom = 32;
  const padLeft = 12;
  const padRight = 12;

  const xFor = (i: number) => {
    if (points.length <= 1) return padLeft + (W - padLeft - padRight) / 2;
    return padLeft + (i / (points.length - 1)) * (W - padLeft - padRight);
  };
  const yFor = (saldo: number) => {
    const norm = (saldo - min) / (range || 1);
    return padTop + (1 - norm) * (H - padTop - padBottom);
  };
  const zeroY = yFor(0);
  const showZero = min < 0 && max > 0;

  const pathD = useMemo(() => {
    if (points.length === 0) return "";
    return points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(p.saldo).toFixed(2)}`)
      .join(" ");
  }, [points, min, max, range, height]);

  // Área debajo de la línea (gradient fill)
  const areaD = useMemo(() => {
    if (points.length === 0) return "";
    const top = points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(p.saldo).toFixed(2)}`)
      .join(" ");
    const base = yFor(min);
    return `${top} L ${xFor(points.length - 1).toFixed(2)} ${base.toFixed(2)} L ${xFor(0).toFixed(2)} ${base.toFixed(2)} Z`;
  }, [points, min, max, range, height]);

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-[var(--muted)]"
        style={{ height }}
      >
        Sin movimientos para graficar
      </div>
    );
  }

  // Tick labels en el eje Y (3 niveles: min, mid, max)
  const yTicks = [max, (max + min) / 2, min];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Líneas de referencia horizontales */}
        {yTicks.map((v, i) => {
          const y = yFor(v);
          return (
            <g key={i}>
              <line
                x1={padLeft}
                y1={y}
                x2={W - padRight}
                y2={y}
                stroke="var(--border)"
                strokeDasharray="2 4"
                strokeWidth="0.5"
              />
              <text
                x={padLeft + 4}
                y={y - 4}
                fontSize="10"
                fill="var(--muted)"
                style={{ pointerEvents: "none" }}
              >
                {fmtCompact(v)}
              </text>
            </g>
          );
        })}

        {/* Línea cero (si min < 0 < max) */}
        {showZero && (
          <line
            x1={padLeft}
            y1={zeroY}
            x2={W - padRight}
            y2={zeroY}
            stroke="var(--muted)"
            strokeWidth="0.8"
            strokeOpacity="0.5"
          />
        )}

        {/* Área debajo de la línea */}
        <path d={areaD} fill="url(#balanceGradient)" />

        {/* Línea principal */}
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* Punto activo en hover */}
        {hover && (
          <g>
            <line
              x1={xFor(hover.i)}
              y1={padTop}
              x2={xFor(hover.i)}
              y2={H - padBottom}
              stroke={color}
              strokeWidth="0.8"
              strokeDasharray="3 3"
              opacity="0.6"
            />
            <circle
              cx={xFor(hover.i)}
              cy={yFor(points[hover.i].saldo)}
              r="5"
              fill={color}
              stroke="white"
              strokeWidth="2"
            />
          </g>
        )}

        {/* Hit areas invisibles para tooltip */}
        {points.map((p, i) => {
          const segW = Math.max((W - padLeft - padRight) / Math.max(points.length - 1, 1), 6);
          const cx = xFor(i);
          return (
            <rect
              key={i}
              x={cx - segW / 2}
              y={padTop}
              width={segW}
              height={H - padTop - padBottom}
              fill="transparent"
              onMouseEnter={(e) => {
                const rect = (e.target as SVGRectElement).getBoundingClientRect();
                setHover({
                  i,
                  x: rect.left + rect.width / 2,
                  y: rect.top,
                });
              }}
            />
          );
        })}

        {/* Labels de fecha (solo primer, último y medio para no saturar) */}
        {points.length > 0 && [0, Math.floor(points.length / 2), points.length - 1]
          .filter((idx, i, arr) => arr.indexOf(idx) === i)
          .map((idx) => (
            <text
              key={idx}
              x={xFor(idx)}
              y={H - 10}
              textAnchor={idx === 0 ? "start" : idx === points.length - 1 ? "end" : "middle"}
              fontSize="11"
              fill="var(--muted)"
            >
              {fmtDateShort(points[idx].fecha, locale)}
            </text>
          ))}
      </svg>

      {/* Tooltip flotante */}
      {hover && (
        <div
          className="fixed z-30 -translate-x-1/2 -translate-y-full mb-2 bg-white dark:bg-slate-900 border border-[var(--border)] rounded-lg shadow-lg px-3 py-2 text-xs pointer-events-none"
          style={{ left: hover.x, top: hover.y - 8 }}
        >
          <p className="font-semibold mb-1 capitalize">
            {fmtDateShort(points[hover.i].fecha, locale)}
          </p>
          <p>
            Saldo:{" "}
            <span className={`font-semibold ${points[hover.i].saldo >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {formatMoney(points[hover.i].saldo, moneda, locale)}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
