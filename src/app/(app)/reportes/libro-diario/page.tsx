"use client";
import { useState, useMemo } from "react";
import { useTable, paisFilter } from "@/lib/useSupabaseData";
import { useConfig } from "@/lib/useConfig";
import { CurrencyCode } from "@/lib/countries";
import { formatMoney, todayISO } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { CONCEPTO_ID_DIFERENCIA_TASA, getPagoPadreFromNotas } from "@/lib/concepts";

function firstDayOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function LibroDiarioPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const moneda = (config?.moneda_base ?? "ARS") as CurrencyCode;

  const { data: allGastos, loading } = useTable("gastos",    { orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: contactos } = useTable("contactos", { orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: cuentas }   = useTable("cuentas",   { orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais] });

  const [desde, setDesde] = useState(firstDayOfMonth());
  const [hasta, setHasta] = useState(todayISO());

  type AsientoLine = { cuenta: string; deudor: number; acreedor: number };
  type Asiento = { codigo: string; fecha: string; tercero: string; contacto_id: number | null; lines: AsientoLine[] };

  const facturaMap = useMemo(() => {
    const map = new Map<number, { total: number; tasa_cambio: number; items: { concepto_nombre?: string; neto?: number; iva_monto?: number; total?: number }[] }>();
    (allGastos ?? []).forEach(g => {
      if (g.tipo === "factura_proveedor") map.set(g.id, { total: Number(g.total), tasa_cambio: Number(g.tasa_cambio || 1), items: Array.isArray(g.items) ? g.items : [] });
    });
    return map;
  }, [allGastos]);

  const asientos = useMemo<Asiento[]>(() => {
    const lbGastos = (allGastos ?? []).filter(g => g.fecha >= desde && g.fecha <= hasta);
    const result: Asiento[] = [];

    for (const g of lbGastos) {
      const tercero = contactos?.find(c => c.id === g.contacto_id)?.nombre ?? "—";
      const tasa = Number(g.tasa_cambio || 1);
      const cuentaNombre = cuentas?.find(c => c.id === g.cuenta_id)?.nombre ?? "Banco/Tarjeta";

      if (g.tipo === "factura_proveedor") {
        const total_ars = Number(g.total) * tasa;
        const items = (Array.isArray(g.items) ? g.items : []) as { concepto_nombre?: string; neto?: number; iva_monto?: number; total?: number }[];
        const lines: AsientoLine[] = [];
        if (items.length > 0) {
          items.forEach(it => {
            const neto_ars = Number(it.neto ?? it.total ?? 0) * tasa;
            if (neto_ars > 0) lines.push({ cuenta: it.concepto_nombre || g.categoria || "Gastos", deudor: neto_ars, acreedor: 0 });
            const iva_ars = Number(it.iva_monto ?? 0) * tasa;
            if (iva_ars > 0) lines.push({ cuenta: "IVA Crédito Fiscal", deudor: iva_ars, acreedor: 0 });
          });
        } else {
          lines.push({ cuenta: g.categoria || g.concepto || "Gastos", deudor: total_ars, acreedor: 0 });
        }
        lines.push({ cuenta: "Proveedores", deudor: 0, acreedor: total_ars });
        result.push({ codigo: `FP-${g.id}`, fecha: g.fecha, tercero, contacto_id: g.contacto_id ?? null, lines });

      } else if (g.tipo === "gasto") {
        // Saltar el gasto subordinado de "Diferencia de tasa de cambio": el
        // libro-diario ya calcula esa diferencia en el asiento del pago padre
        // (líneas exchangeLoss/exchangeGain abajo). Incluirlo otra vez como
        // gasto independiente sería double counting.
        if (g.concepto_id === CONCEPTO_ID_DIFERENCIA_TASA && getPagoPadreFromNotas(g.notas) != null) continue;

        const fps = (g.factura_pagos ?? []) as { factura_id: number; monto: number; retenciones?: { tipo: string; monto: number }[] }[];
        const lines: AsientoLine[] = [];

        if (fps.length > 0) {
          let totalProveedoresDebit = 0;
          let totalExchangeGain = 0;
          let totalExchangeLoss = 0;
          const retPorTipo: Record<string, number> = {};

          for (const fp of fps) {
            const facturaTasa = facturaMap.get(fp.factura_id)?.tasa_cambio ?? tasa;
            const fpMonto = Number(fp.monto);
            const proveedoresDebit = fpMonto * facturaTasa;
            totalProveedoresDebit += proveedoresDebit;
            const diff = proveedoresDebit - fpMonto * tasa;
            if (diff > 0.5) totalExchangeGain += diff;
            else if (diff < -0.5) totalExchangeLoss += -diff;
            for (const ret of fp.retenciones ?? []) {
              const retARS = Number(ret.monto) * tasa;
              retPorTipo[ret.tipo] = (retPorTipo[ret.tipo] ?? 0) + retARS;
            }
          }

          lines.push({ cuenta: "Proveedores", deudor: totalProveedoresDebit, acreedor: 0 });
          if (totalExchangeLoss > 0.5) lines.push({ cuenta: "Diferencia de cambio", deudor: totalExchangeLoss, acreedor: 0 });
          lines.push({ cuenta: cuentaNombre, deudor: 0, acreedor: Number(g.total) * tasa });
          for (const [tipo, monto] of Object.entries(retPorTipo)) lines.push({ cuenta: tipo, deudor: 0, acreedor: monto });
          if (totalExchangeGain > 0.5) lines.push({ cuenta: "Diferencia de cambio", deudor: 0, acreedor: totalExchangeGain });

        } else {
          const items = (Array.isArray(g.items) ? g.items : []) as { concepto_nombre?: string; total?: number; neto?: number }[];
          if (items.length > 0) {
            items.forEach(it => {
              const monto_ars = Number(it.total ?? it.neto ?? 0) * tasa;
              if (monto_ars > 0) lines.push({ cuenta: it.concepto_nombre || g.categoria || "Gastos", deudor: monto_ars, acreedor: 0 });
            });
          } else {
            lines.push({ cuenta: g.concepto || g.categoria || "Gastos", deudor: Number(g.total) * tasa, acreedor: 0 });
          }
          lines.push({ cuenta: cuentaNombre, deudor: 0, acreedor: Number(g.total) * tasa });
        }

        result.push({ codigo: `CP-${g.id}`, fecha: g.fecha, tercero, contacto_id: g.contacto_id ?? null, lines });
      }
    }

    return result.sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [allGastos, desde, hasta, contactos, cuentas, facturaMap]);

  return (
    <>
      <PageHeader title="Libro diario" description="Asientos contables del periodo" />

      <div className="card mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label className="label">Desde</label><input type="date" className="input" value={desde} onChange={e => setDesde(e.target.value)} /></div>
          <div><label className="label">Hasta</label><input type="date" className="input" value={hasta} onChange={e => setHasta(e.target.value)} /></div>
          <div className="flex items-end"><button className="btn btn-secondary w-full" onClick={() => { setDesde(firstDayOfMonth()); setHasta(todayISO()); }}>Este mes</button></div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--muted)]" />
        </div>
      ) : asientos.length === 0 ? (
        <div className="card py-12 text-center text-sm text-[var(--muted)]">No hay movimientos en el periodo seleccionado.</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--border)] bg-slate-50 text-sm text-[var(--muted)]">
            {asientos.length} asiento{asientos.length !== 1 ? "s" : ""}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-[var(--border)]">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide w-32">Asiento</th>
                <th className="text-left px-3 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide w-24">Fecha</th>
                <th className="text-left px-3 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">Tercero</th>
                <th className="text-left px-3 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">Cuenta contable</th>
                <th className="text-right px-3 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide w-36">Deudor</th>
                <th className="text-right px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide w-36">Acreedor</th>
              </tr>
            </thead>
            <tbody>
              {asientos.map((asiento, ai) =>
                asiento.lines.map((line, li) => (
                  <tr key={`${ai}-${li}`} className={`${li === 0 && ai > 0 ? "border-t-2 border-slate-400" : "border-t border-slate-100"} hover:bg-slate-50`}>
                    {li === 0 ? (
                      <>
                        <td className="px-4 py-2 font-mono text-xs text-[var(--primary)] font-semibold" rowSpan={asiento.lines.length}>
                          <Link href={asiento.codigo.startsWith("FP") ? `/egresos/facturas/${asiento.codigo.replace("FP-","")}` : `/egresos/pagos/${asiento.codigo.replace("CP-","")}`} className="hover:underline">
                            {asiento.codigo}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-[var(--muted)] whitespace-nowrap text-xs" rowSpan={asiento.lines.length}>{asiento.fecha}</td>
                        <td className="px-3 py-2 text-xs" rowSpan={asiento.lines.length}>
                          {asiento.contacto_id ? <Link href={`/contactos/${asiento.contacto_id}`} className="hover:underline hover:text-[var(--primary)] font-medium">{asiento.tercero}</Link> : <span className="text-[var(--muted)]">{asiento.tercero}</span>}
                        </td>
                      </>
                    ) : null}
                    <td className="px-3 py-1.5 text-xs">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                        line.cuenta === "Proveedores" ? "bg-blue-50 text-blue-700" :
                        line.cuenta === "Diferencia de cambio" ? "bg-orange-50 text-orange-700" :
                        line.cuenta.startsWith("Retenci") ? "bg-amber-50 text-amber-700" :
                        line.cuenta === "IVA Crédito Fiscal" ? "bg-purple-50 text-purple-700" :
                        line.deudor > 0 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
                      }`}>
                        {line.cuenta}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-xs font-mono">{line.deudor > 0 ? formatMoney(line.deudor, moneda, country.locale) : ""}</td>
                    <td className="px-4 py-1.5 text-right text-xs font-mono">{line.acreedor > 0 ? formatMoney(line.acreedor, moneda, country.locale) : ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
