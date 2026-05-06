"use client";
import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/format";
import type { CurrencyCode } from "@/lib/countries";

type Series = { label: string; color: string; values: number[] };
type Props = {
  monthLabels: string[];      // ["May", "Jun", "Jul", "Ago", "Sep", "Oct"]
  series: Series[];
  monedaBase: CurrencyCode;
  locale: string;
  height?: number;
};

/** Formato compacto para ejes / tooltips en celdas chicas */
function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (abs >= 1_000) return `${Math.round(n / 1000)}K`;
  return Math.round(n).toString();
}

export default function MonthlyBarChart({ monthLabels, series, monedaBase, locale, height = 220 }: Props) {
  const [hover, setHover] = useState<{ m: number; x: number; y: number } | null>(null);

  const max = useMemo(() => {
    let v = 0;
    for (const s of series) for (const x of s.values) if (x > v) v = x;
    return v || 1;
  }, [series]);

  const months = monthLabels.length;
  const groupGap = 12;          // gap entre meses
  const barGap = 4;             // gap entre barras del mismo mes
  const numSeries = series.length;
  const padTop = 18;
  const padBottom = 28;
  const padLeft = 8;
  const padRight = 8;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 600 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
      >
        {/* Líneas de referencia */}
        {[0.25, 0.5, 0.75, 1].map((p) => (
          <line
            key={p}
            x1={padLeft}
            y1={padTop + (height - padTop - padBottom) * (1 - p)}
            x2={600 - padRight}
            y2={padTop + (height - padTop - padBottom) * (1 - p)}
            stroke="var(--border)"
            strokeDasharray="2 4"
            strokeWidth="0.5"
          />
        ))}

        {monthLabels.map((label, i) => {
          const groupWidth = (600 - padLeft - padRight - groupGap * (months - 1)) / months;
          const groupX = padLeft + i * (groupWidth + groupGap);
          const barWidth = (groupWidth - barGap * (numSeries - 1)) / numSeries;

          return (
            <g key={i}>
              {/* Hit area para tooltip */}
              <rect
                x={groupX - groupGap / 2}
                y={padTop}
                width={groupWidth + groupGap}
                height={height - padTop - padBottom}
                fill="transparent"
                onMouseEnter={(e) => {
                  const rect = (e.target as SVGRectElement).getBoundingClientRect();
                  setHover({
                    m: i,
                    x: rect.left + rect.width / 2,
                    y: rect.top,
                  });
                }}
              />
              {/* Barras */}
              {series.map((s, j) => {
                const v = s.values[i] ?? 0;
                const rawH = (v / max) * (height - padTop - padBottom);
                // Si hay valor: alto real (mín 2px). Si es 0: barra fantasma de 2px tenue.
                const isEmpty = v <= 0;
                const barH = isEmpty ? 2 : Math.max(rawH, 2);
                const x = groupX + j * (barWidth + barGap);
                const y = height - padBottom - barH;
                const baseOpacity = isEmpty ? 0.18 : 1;
                const dimmed = hover && hover.m !== i;
                return (
                  <g key={j}>
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={barH}
                      rx="2"
                      fill={s.color}
                      opacity={dimmed ? baseOpacity * 0.4 : baseOpacity}
                      style={{ transition: "opacity 0.15s" }}
                    />
                  </g>
                );
              })}
              {/* Label del mes */}
              <text
                x={groupX + groupWidth / 2}
                y={height - 8}
                textAnchor="middle"
                fontSize="11"
                fill="var(--muted)"
                style={{ textTransform: "capitalize" }}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Tooltip flotante */}
      {hover && (
        <div
          className="fixed z-30 -translate-x-1/2 -translate-y-full mb-2 bg-white border border-[var(--border)] rounded-lg shadow-lg px-3 py-2 text-xs pointer-events-none"
          style={{ left: hover.x, top: hover.y - 8 }}
        >
          <p className="font-semibold mb-1 capitalize">{monthLabels[hover.m]}</p>
          {series.map((s, j) => (
            <div key={j} className="flex items-center gap-2 whitespace-nowrap">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
              <span className="text-slate-600">{s.label}:</span>
              <span className="font-medium">
                {formatMoney(s.values[hover.m] ?? 0, monedaBase, locale)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Leyenda */}
      <div className="flex items-center justify-center gap-4 mt-2 text-xs text-slate-500">
        {series.map((s, j) => (
          <div key={j} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: s.color }} />
            <span>{s.label}</span>
          </div>
        ))}
        <span className="text-slate-400 ml-2">Máx: {fmtCompact(max)}</span>
      </div>
    </div>
  );
}
