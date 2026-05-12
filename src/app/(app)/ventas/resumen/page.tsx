"use client";
import { useEffect, useState, useMemo, Fragment } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { Loader2, AlertTriangle, Info } from "lucide-react";

type Row = {
  mes: string;          // 'YYYY-MM'
  canal: string;
  cantidad: number;
  cant_entregadas: number;
  cant_canceladas: number;
  total_bruto: number;
  total_neto: number;
};

type Canal = "falabella" | "walmart" | "mercado_libre";

const CANALES_VISIBLES: Canal[] = ["falabella", "walmart", "mercado_libre"];
const CANAL_LABELS: Record<Canal, string> = {
  falabella: "Falabella",
  walmart: "Walmart",
  mercado_libre: "Mercado Libre",
};

function nombreMes(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  return `${meses[Number(m) - 1] ?? m} ${y}`;
}

export default function VentasResumenPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("ventas_resumen_mensual_v")
      .select("mes, canal, cantidad, cant_entregadas, cant_canceladas, total_bruto, total_neto")
      .order("mes", { ascending: false })
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message);
          return;
        }
        setRows(
          (data ?? []).map((r) => ({
            mes: String(r.mes ?? ""),
            canal: String(r.canal ?? ""),
            cantidad: Number(r.cantidad ?? 0),
            cant_entregadas: Number(r.cant_entregadas ?? 0),
            cant_canceladas: Number(r.cant_canceladas ?? 0),
            total_bruto: Number(r.total_bruto ?? 0),
            total_neto: Number(r.total_neto ?? 0),
          })),
        );
      });
  }, []);

  // Pivot por mes × canal (con totales)
  const { meses, porMesCanal, totalPorCanal, totalPorMes, granTotal } = useMemo(() => {
    const meses: string[] = [];
    const porMesCanal: Record<string, Partial<Record<Canal, Row>>> = {};
    const totalPorCanal: Partial<Record<Canal, { cantidad: number; neto: number; bruto: number }>> = {};
    const totalPorMes: Record<string, { cantidad: number; neto: number; bruto: number }> = {};
    const granTotal = { cantidad: 0, neto: 0, bruto: 0 };

    if (!rows) return { meses, porMesCanal, totalPorCanal, totalPorMes, granTotal };

    for (const r of rows) {
      if (!porMesCanal[r.mes]) {
        porMesCanal[r.mes] = {};
        meses.push(r.mes);
      }
      const c = r.canal as Canal;
      porMesCanal[r.mes]![c] = r;

      const tc = totalPorCanal[c] ?? { cantidad: 0, neto: 0, bruto: 0 };
      tc.cantidad += r.cantidad;
      tc.neto += r.total_neto;
      tc.bruto += r.total_bruto;
      totalPorCanal[c] = tc;

      const tm = totalPorMes[r.mes] ?? { cantidad: 0, neto: 0, bruto: 0 };
      tm.cantidad += r.cantidad;
      tm.neto += r.total_neto;
      tm.bruto += r.total_bruto;
      totalPorMes[r.mes] = tm;

      granTotal.cantidad += r.cantidad;
      granTotal.neto += r.total_neto;
      granTotal.bruto += r.total_bruto;
    }
    return { meses, porMesCanal, totalPorCanal, totalPorMes, granTotal };
  }, [rows]);

  // Solo mostramos columnas de canales con datos (los placeholders quedan grises)
  const canalesConDatos = useMemo(() => {
    return CANALES_VISIBLES.filter((c) => (totalPorCanal[c]?.cantidad ?? 0) > 0);
  }, [totalPorCanal]);

  const canalesPendientes = CANALES_VISIBLES.filter((c) => !canalesConDatos.includes(c));

  const subtotalesPorAnio = useMemo(() => {
    const map = new Map<string, { cantidad: number; neto: number; bruto: number }>();
    for (const mes of meses) {
      const anio = mes.slice(0, 4);
      const t = totalPorMes[mes];
      const acc = map.get(anio) ?? { cantidad: 0, neto: 0, bruto: 0 };
      acc.cantidad += t.cantidad;
      acc.neto += t.neto;
      acc.bruto += t.bruto;
      map.set(anio, acc);
    }
    return map;
  }, [meses, totalPorMes]);

  return (
    <div>
      <PageHeader
        title="Ventas — Resumen mensual"
        description="Total facturado por mes y canal en Chile. Suma de Falabella, Walmart y Mercado Libre."
      />

      {canalesPendientes.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-4 flex items-start gap-2 text-sm text-amber-800">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            Canales pendientes de integrar: <strong>{canalesPendientes.map((c) => CANAL_LABELS[c]).join(", ")}</strong>.
            Cuando estén conectados, sus columnas se agregan automáticamente.
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          Error cargando datos: {error}
        </div>
      )}

      {!rows && !error && (
        <div className="flex items-center justify-center py-16 text-[var(--muted)]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando resumen…
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="rounded-lg border border-[var(--border)] p-8 text-center text-[var(--muted)]">
          No hay ventas sincronizadas todavía.
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left font-medium px-4 py-2">Mes</th>
                {canalesConDatos.map((c) => (
                  <th key={c} className="text-right font-medium px-4 py-2">{CANAL_LABELS[c]}</th>
                ))}
                <th className="text-right font-medium px-4 py-2 bg-[var(--primary-soft)]">Total mes</th>
                <th className="text-right font-medium px-4 py-2">#</th>
              </tr>
            </thead>
            <tbody>
              {meses.map((mes, idx) => {
                const anio = mes.slice(0, 4);
                const proxMes = meses[idx + 1];
                const esUltimaDelAnio = !proxMes || proxMes.slice(0, 4) !== anio;
                const subAnio = esUltimaDelAnio ? subtotalesPorAnio.get(anio) : null;
                const tm = totalPorMes[mes];
                return (
                  <Fragment key={mes}>
                    <tr className="border-t border-[var(--border)] hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium">{nombreMes(mes)}</td>
                      {canalesConDatos.map((c) => {
                        const r = porMesCanal[mes]?.[c];
                        return (
                          <td key={c} className="px-4 py-2 text-right tabular-nums">
                            {r?.total_neto ? formatMoney(r.total_neto, "CLP", "es-CL") : "—"}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2 text-right tabular-nums font-semibold bg-[var(--primary-soft)]/40">
                        {formatMoney(tm.neto, "CLP", "es-CL")}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-[var(--muted)]">{tm.cantidad}</td>
                    </tr>
                    {subAnio && (
                      <tr className="border-t-2 border-[var(--border)] bg-slate-100 font-medium">
                        <td className="px-4 py-2">Total {anio}</td>
                        {canalesConDatos.map((c) => {
                          const cant = meses
                            .filter((m) => m.slice(0, 4) === anio)
                            .reduce((acc, m) => acc + (porMesCanal[m]?.[c]?.total_neto ?? 0), 0);
                          return (
                            <td key={c} className="px-4 py-2 text-right tabular-nums">
                              {cant ? formatMoney(cant, "CLP", "es-CL") : "—"}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2 text-right tabular-nums bg-[var(--primary-soft)]/60">
                          {formatMoney(subAnio.neto, "CLP", "es-CL")}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-[var(--muted)]">{subAnio.cantidad}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold border-t-2 border-[var(--border)]">
              <tr>
                <td className="px-4 py-2">Total</td>
                {canalesConDatos.map((c) => (
                  <td key={c} className="px-4 py-2 text-right tabular-nums">
                    {formatMoney(totalPorCanal[c]?.neto ?? 0, "CLP", "es-CL")}
                  </td>
                ))}
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatMoney(granTotal.neto, "CLP", "es-CL")}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-[var(--muted)]">{granTotal.cantidad}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
