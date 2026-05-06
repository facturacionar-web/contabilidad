"use client";
import { useState, useMemo } from "react";
import { useTable, paisFilter } from "@/lib/useSupabaseData";
import { useConfig } from "@/lib/useConfig";
import { CurrencyCode } from "@/lib/countries";
import { formatMoney, todayISO } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { Download, Loader2 } from "lucide-react";
import Link from "next/link";
import * as XLSX from "xlsx";

function firstDayOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function toLocal(amount: number, entryMoneda: string, tasa: number, localMoneda: string) {
  return entryMoneda === localMoneda ? amount : amount * (tasa || 1);
}

export default function ReportesRetencionesPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const moneda = (config?.moneda_base ?? "ARS") as CurrencyCode;

  const { data: allGastos, loading } = useTable("gastos",    { orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: contactos } = useTable("contactos", { orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais] });

  const [retDesde,     setRetDesde]     = useState(firstDayOfMonth());
  const [retHasta,     setRetHasta]     = useState(todayISO());
  const [retTipoFiltro, setRetTipoFiltro] = useState("");

  type RetRow = { fecha: string; proveedor: string; tax_id: string; contacto_id: number | null; numero_factura: string; factura_id: number; total_factura: number; tipo: string; moneda: CurrencyCode; monto: number; monto_base: number };

  const allPagos = useMemo(() => (allGastos ?? []).filter(g => g.tipo === "gasto"), [allGastos]);

  const retenciones = useMemo<RetRow[]>(() => {
    const rows: RetRow[] = [];
    for (const g of allPagos) {
      if (g.fecha < retDesde || g.fecha > retHasta) continue;
      const contacto = contactos?.find(c => c.id === g.contacto_id);
      const fps = (g.factura_pagos ?? []) as { factura_id: number; numero_factura: string | null; total_factura?: number; retenciones?: { tipo: string; monto: number }[] }[];
      for (const fp of fps) {
        for (const ret of fp.retenciones ?? []) {
          if (!ret.monto) continue;
          rows.push({ fecha: g.fecha, proveedor: contacto?.nombre ?? "—", tax_id: contacto?.tax_id ?? "", contacto_id: g.contacto_id ?? null, numero_factura: fp.numero_factura ?? `#${fp.factura_id}`, factura_id: fp.factura_id, total_factura: Number(fp.total_factura ?? 0), tipo: ret.tipo, moneda: g.moneda, monto: Number(ret.monto), monto_base: toLocal(Number(ret.monto), g.moneda, Number(g.tasa_cambio || 1), moneda) });
        }
      }
    }
    return rows.sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [allPagos, contactos, moneda, retDesde, retHasta]);

  const retencionesPorTipo = useMemo(() => {
    const map: Record<string, number> = {};
    retenciones.forEach(r => { map[r.tipo] = (map[r.tipo] ?? 0) + r.monto_base; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [retenciones]);

  const totalRetenciones = retencionesPorTipo.reduce((s, [, v]) => s + v, 0);
  const retencionesFiltradas = useMemo(() => retTipoFiltro ? retenciones.filter(r => r.tipo === retTipoFiltro) : retenciones, [retenciones, retTipoFiltro]);
  const totalRetencionesFiltradas = useMemo(() => retencionesFiltradas.reduce((s, r) => s + r.monto_base, 0), [retencionesFiltradas]);

  function exportXLSX() {
    const rows = retencionesFiltradas.map(r => ({ Fecha: r.fecha, Proveedor: r.proveedor, "CUIT/Tax ID": r.tax_id, "N° Factura": r.numero_factura, "Total factura": r.total_factura, "Tipo de retención": r.tipo, Moneda: r.moneda, Monto: r.monto, [`Monto ${moneda}`]: r.monto_base }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 20 }, { wch: 16 }, { wch: 22 }, { wch: 8 }, { wch: 14 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Retenciones");
    const slug = retTipoFiltro ? `_${retTipoFiltro.replace(/\s+/g, "_").toLowerCase()}` : "";
    XLSX.writeFile(wb, `retenciones${slug}_${retDesde}_a_${retHasta}.xlsx`);
  }

  return (
    <>
      <PageHeader title="Retenciones" description="Retenciones aplicadas en pagos a proveedores"
        action={retenciones.length > 0 ? <button className="btn btn-primary" onClick={exportXLSX}><Download className="w-4 h-4" /> Exportar XLSX</button> : undefined}
      />

      <div className="card mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label className="label">Desde</label><input type="date" className="input" value={retDesde} onChange={e => setRetDesde(e.target.value)} /></div>
          <div><label className="label">Hasta</label><input type="date" className="input" value={retHasta} onChange={e => setRetHasta(e.target.value)} /></div>
          <div className="flex items-end"><button className="btn btn-secondary w-full" onClick={() => { setRetDesde(firstDayOfMonth()); setRetHasta(todayISO()); setRetTipoFiltro(""); }}>Este mes</button></div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--muted)]" />
        </div>
      ) : retenciones.length === 0 ? (
        <div className="card py-12 text-center text-sm text-[var(--muted)]">No hay retenciones en el periodo seleccionado.</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          {/* Chips filtro */}
          <div className="px-5 py-4 border-b border-[var(--border)] flex flex-wrap gap-3 items-center">
            <span className="text-xs text-[var(--muted)] font-medium uppercase tracking-wide mr-1">Filtrar:</span>
            <button onClick={() => setRetTipoFiltro("")} className={`rounded-lg px-4 py-2 text-sm border transition-colors ${retTipoFiltro === "" ? "bg-slate-700 border-slate-700 text-white font-semibold" : "bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200"}`}>Todos</button>
            {retencionesPorTipo.map(([tipo, total]) => {
              const active = retTipoFiltro === tipo;
              return (
                <button key={tipo} onClick={() => setRetTipoFiltro(active ? "" : tipo)} className={`rounded-lg px-4 py-2 text-sm border transition-colors ${active ? "bg-amber-500 border-amber-500 text-white font-semibold" : "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"}`}>
                  <span className="font-medium">{tipo}</span>
                  <span className={`mx-2 ${active ? "text-amber-200" : "text-amber-400"}`}>·</span>
                  <span className={active ? "text-white" : "font-semibold text-amber-800"}>{formatMoney(total, moneda, country.locale)}</span>
                </button>
              );
            })}
            <div className="bg-slate-100 rounded-lg px-4 py-2 text-sm border border-slate-200 ml-auto">
              <span className="text-[var(--muted)]">Total{retTipoFiltro ? " filtrado" : ""}</span>
              <span className="mx-2 text-slate-400">·</span>
              <span className="font-bold">{formatMoney(totalRetencionesFiltradas, moneda, country.locale)}</span>
            </div>
          </div>

          {retencionesFiltradas.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-[var(--muted)]">No hay retenciones del tipo seleccionado.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-[var(--border)]">
                <tr>
                  {["Fecha","Proveedor","CUIT/Tax ID","N° Factura","Total factura","Tipo","Monto","Monto " + moneda].map((h, i) => (
                    <th key={h} className={`py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide ${i === 0 ? "text-left px-5" : i >= 4 ? "text-right px-4" : "text-left px-4"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {retencionesFiltradas.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-5 py-2.5 text-[var(--muted)] whitespace-nowrap">{r.fecha}</td>
                    <td className="px-4 py-2.5">{r.contacto_id ? <Link href={`/contactos/${r.contacto_id}`} className="hover:underline hover:text-[var(--primary)] font-medium">{r.proveedor}</Link> : <span className="text-[var(--muted)]">{r.proveedor}</span>}</td>
                    <td className="px-4 py-2.5 text-[var(--muted)] text-xs">{r.tax_id || "—"}</td>
                    <td className="px-4 py-2.5"><Link href={`/egresos/facturas/${r.factura_id}`} className="hover:underline hover:text-[var(--primary)] text-[var(--muted)]">{r.numero_factura}</Link></td>
                    <td className="px-4 py-2.5 text-right text-[var(--muted)] whitespace-nowrap">{r.total_factura > 0 ? formatMoney(r.total_factura, r.moneda, country.locale) : "—"}</td>
                    <td className="px-4 py-2.5"><span className="badge badge-warning">{r.tipo}</span></td>
                    <td className="px-4 py-2.5 text-right text-[var(--muted)] whitespace-nowrap">{formatMoney(r.monto, r.moneda, country.locale)}</td>
                    <td className="px-5 py-2.5 text-right font-semibold text-amber-700 whitespace-nowrap">{formatMoney(r.monto_base, moneda, country.locale)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-[var(--border)] bg-[var(--surface-hover)]">
                <tr>
                  <td colSpan={6} className="px-5 py-2.5 text-right font-semibold text-[var(--muted)]">Total retenciones {moneda}</td>
                  <td colSpan={2} className="px-5 py-2.5 text-right font-bold text-base text-amber-800">{formatMoney(totalRetencionesFiltradas, moneda, country.locale)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </>
  );
}
