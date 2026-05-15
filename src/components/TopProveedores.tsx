"use client";
import Link from "next/link";
import type { Gasto, Contacto } from "@/lib/types";
import type { CurrencyCode } from "@/lib/countries";
import { formatMoney } from "@/lib/format";
import { CONCEPTO_ID_DIFERENCIA_TASA, getPagoPadreFromNotas } from "@/lib/concepts";
import { Trophy, ArrowRight } from "lucide-react";

type Props = {
  pagos: Gasto[];           // tipo === "gasto" (pagos efectivos)
  facturas?: Gasto[];       // tipo === "factura_proveedor", solo para contar facturas
  contactos: Contacto[];
  monedaBase: CurrencyCode;
  locale: string;
  limit?: number;
  startDate?: string;       // YYYY-MM-DD inclusive
  endDate?: string;         // YYYY-MM-DD inclusive
  title?: string;
};

export default function TopProveedores({
  pagos,
  facturas,
  contactos,
  monedaBase,
  locale,
  limit = 10,
  startDate,
  endDate,
  title = "Top proveedores",
}: Props) {
  const inRange = (iso: string) =>
    (!startDate || iso >= startDate) && (!endDate || iso <= endDate);

  // Acumular por contacto_id en moneda base. Los gastos subordinados de
  // "Diferencia de tasa de cambio" ya tienen el mismo contacto_id que su
  // pago padre, así que se suman naturalmente acá (no necesitan cross-ref).
  // El conteo de "pagos" excluye los subordinados para no inflar el N.
  const acc = new Map<number, { total: number; count: number }>();
  for (const p of pagos) {
    if (!p.contacto_id) continue;
    if (!inRange(p.fecha)) continue;
    const esSubordinado =
      p.concepto_id === CONCEPTO_ID_DIFERENCIA_TASA &&
      getPagoPadreFromNotas(p.notas) != null;
    const tasa = Number(p.tasa_cambio || 1);
    const total = Number(p.total) * (p.moneda === monedaBase ? 1 : tasa);
    const cur = acc.get(p.contacto_id) ?? { total: 0, count: 0 };
    cur.total += total;
    if (!esSubordinado) cur.count += 1;
    acc.set(p.contacto_id, cur);
  }

  // Cantidad de facturas (info adicional)
  const facturaCount = new Map<number, number>();
  for (const f of facturas ?? []) {
    if (!f.contacto_id) continue;
    if (!inRange(f.fecha)) continue;
    facturaCount.set(f.contacto_id, (facturaCount.get(f.contacto_id) ?? 0) + 1);
  }

  const ranked = [...acc.entries()]
    .map(([id, v]) => {
      const c = contactos.find((x) => x.id === id);
      return {
        id,
        nombre: c?.nombre ?? `#${id}`,
        total: v.total,
        pagos: v.count,
        facturas: facturaCount.get(id) ?? 0,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);

  const totalTodos = ranked.reduce((s, r) => s + r.total, 0);

  if (ranked.length === 0) {
    return (
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Trophy className="w-4 h-4 text-amber-500" />
          <h3 className="font-semibold">{title}</h3>
        </div>
        <p className="text-sm text-slate-400 py-6 text-center">
          Sin pagos registrados en este período
        </p>
      </div>
    );
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          <h3 className="font-semibold">{title}</h3>
        </div>
        <Link
          href="/reportes/gastos"
          className="text-xs text-[var(--primary)] hover:underline flex items-center gap-1"
        >
          Ver reporte <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {ranked.map((r, i) => {
          const pct = totalTodos > 0 ? (r.total / totalTodos) * 100 : 0;
          return (
            <Link
              key={r.id}
              href={`/contactos/${r.id}`}
              className="block px-5 py-3 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center justify-between gap-3 mb-1">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 ${
                      i === 0
                        ? "bg-amber-100 text-amber-700"
                        : i === 1
                        ? "bg-slate-200 text-slate-600"
                        : i === 2
                        ? "bg-orange-100 text-orange-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <p className="font-medium text-sm text-slate-700 truncate">
                    {r.nombre}
                  </p>
                </div>
                <p className="text-sm font-semibold whitespace-nowrap">
                  {formatMoney(r.total, monedaBase, locale)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--primary)] rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[11px] text-slate-400 whitespace-nowrap min-w-[80px] text-right">
                  {r.pagos} pago{r.pagos !== 1 ? "s" : ""} · {pct.toFixed(0)}%
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
