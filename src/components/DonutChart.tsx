"use client";
import { useMemo, useState } from "react";
import type { CurrencyCode } from "@/lib/countries";
import { formatMoney } from "@/lib/format";

export type DonutSlice = {
  label: string;
  value: number;
  color: string;
};

type Props = {
  slices: DonutSlice[];
  moneda: CurrencyCode;
  locale: string;
  size?: number;
  thickness?: number;
  centerLabel?: string;
};

/**
 * Donut chart simple (SVG circular). Cada slice ocupa una porción del
 * círculo proporcional a su `value`. El total se muestra en el centro.
 * Hover sobre un slice → resalta + tooltip con monto + porcentaje.
 */
export default function DonutChart({
  slices,
  moneda,
  locale,
  size = 220,
  thickness = 28,
  centerLabel,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const total = useMemo(() => slices.reduce((s, x) => s + x.value, 0), [slices]);
  const radius = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  if (total <= 0 || slices.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-[var(--muted)]"
        style={{ height: size }}
      >
        Sin datos
      </div>
    );
  }

  let cumulative = 0;
  const segs = slices.map((s) => {
    const start = cumulative;
    const fraction = s.value / total;
    cumulative += fraction;
    return {
      slice: s,
      offset: start * circumference,
      length: fraction * circumference,
      fraction,
    };
  });

  return (
    <div className="relative inline-block">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: "rotate(-90deg)" }}
      >
        {/* fondo del anillo */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={thickness}
          opacity="0.3"
        />
        {segs.map((seg, i) => {
          const dim = hover != null && hover !== i;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={seg.slice.color}
              strokeWidth={hover === i ? thickness + 4 : thickness}
              strokeDasharray={`${seg.length} ${circumference - seg.length}`}
              strokeDashoffset={-seg.offset}
              strokeLinecap="butt"
              opacity={dim ? 0.35 : 1}
              style={{ cursor: "pointer", transition: "stroke-width 0.15s, opacity 0.15s" }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>
      {/* centro: total o slice hover */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        {hover != null ? (
          <>
            <p className="text-[10px] uppercase tracking-wide text-[var(--muted)] text-center px-3 truncate max-w-[80%]">
              {segs[hover].slice.label}
            </p>
            <p className="text-sm font-bold text-center mt-0.5" style={{ color: segs[hover].slice.color }}>
              {formatMoney(segs[hover].slice.value, moneda, locale)}
            </p>
            <p className="text-[10px] text-[var(--muted)] mt-0.5">
              {(segs[hover].fraction * 100).toFixed(1)}%
            </p>
          </>
        ) : (
          <>
            <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
              {centerLabel ?? "Total"}
            </p>
            <p className="text-base font-bold mt-0.5">
              {formatMoney(total, moneda, locale)}
            </p>
            <p className="text-[10px] text-[var(--muted)] mt-0.5">
              {slices.length} {slices.length === 1 ? "categoría" : "categorías"}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
