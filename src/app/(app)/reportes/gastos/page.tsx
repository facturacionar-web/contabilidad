"use client";
import { useState, useMemo } from "react";
import { useTable, paisFilter } from "@/lib/useSupabaseData";
import { useConfig } from "@/lib/useConfig";
import { CurrencyCode } from "@/lib/countries";
import { formatMoney, todayISO } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { Download, TrendingUp, TrendingDown, Wallet, Loader2 } from "lucide-react";
import Link from "next/link";
import * as XLSX from "xlsx";

function firstDayOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function toLocal(amount: number, entryMoneda: string, tasa: number, localMoneda: string) {
  return entryMoneda === localMoneda ? amount : amount * (tasa || 1);
}

export default function ReportesGastosPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const moneda = (config?.moneda_base ?? "ARS") as CurrencyCode;
  const [desde, setDesde] = useState(firstDayOfMonth());
  const [hasta, setHasta] = useState(todayISO());

  const { data: allIngresos, loading } = useTable("ingresos", { orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: allGastos }   = useTable("gastos",   { orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: allNotas }    = useTable("notas_credito", { orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: contactos }   = useTable("contactos", { orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: cuentas }     = useTable("cuentas",   { orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais] });

  const ingresos = useMemo(() => (allIngresos ?? []).filter(r => r.fecha >= desde && r.fecha <= hasta), [allIngresos, desde, hasta]);
  const gastos   = useMemo(() => (allGastos   ?? []).filter(r => r.fecha >= desde && r.fecha <= hasta), [allGastos,   desde, hasta]);
  const notas    = useMemo(() => (allNotas    ?? []).filter(r => r.fecha >= desde && r.fecha <= hasta), [allNotas,    desde, hasta]);

  const facturaItemsMap = useMemo(() => {
    const map: Record<number, { concepto_nombre?: string; total?: number }[]> = {};
    (allGastos ?? []).forEach(g => { if (g.tipo === "factura_proveedor" && g.id) map[g.id] = Array.isArray(g.items) ? g.items : []; });
    return map;
  }, [allGastos]);

  const pagos = useMemo(() => gastos.filter(g => g.tipo === "gasto"), [gastos]);

  const totalIngresos = useMemo(() => ingresos.reduce((s, i) => s + toLocal(Number(i.monto), i.moneda, Number(i.tasa_cambio || 1), moneda), 0), [ingresos, moneda]);
  const totalGastos   = useMemo(() => pagos.reduce((s, g) => s + toLocal(Number(g.total), g.moneda, Number(g.tasa_cambio || 1), moneda), 0), [pagos, moneda]);
  const balance = totalIngresos - totalGastos;

  const porCategoriaIngresos = useMemo(() => {
    const map: Record<string, number> = {};
    ingresos.forEach(i => { const k = i.categoria || "Sin categoría"; map[k] = (map[k] ?? 0) + toLocal(Number(i.monto), i.moneda, Number(i.tasa_cambio || 1), moneda); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [ingresos, moneda]);

  const porCategoriaGastos = useMemo(() => {
    const map: Record<string, number> = {};
    pagos.forEach(g => {
      const tasa = Number(g.tasa_cambio || 1);
      const fps: { factura_id?: number; monto?: number }[] = Array.isArray(g.factura_pagos) ? g.factura_pagos : [];
      if (fps.length > 0) {
        for (const fp of fps) {
          if (!fp.factura_id) continue;
          const fpLocal = toLocal(Number(fp.monto ?? 0), g.moneda, tasa, moneda);
          const items = facturaItemsMap[fp.factura_id] ?? [];
          const itemsTotal = items.reduce((s, it) => s + Number(it.total ?? 0), 0);
          if (items.length > 0 && itemsTotal > 0) items.forEach(item => { const k = item.concepto_nombre || "Sin categoría"; map[k] = (map[k] ?? 0) + fpLocal * (Number(item.total) / itemsTotal); });
        }
        const directItems: { concepto_nombre?: string; total?: number }[] = Array.isArray(g.items) ? g.items : [];
        directItems.forEach(item => { if (item.concepto_nombre) map[item.concepto_nombre] = (map[item.concepto_nombre] ?? 0) + toLocal(Number(item.total ?? 0), g.moneda, tasa, moneda); });
      } else if (g.concepto_id) {
        const k = g.categoria || "Sin categoría";
        map[k] = (map[k] ?? 0) + toLocal(Number(g.total), g.moneda, tasa, moneda);
      }
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [pagos, facturaItemsMap, moneda]);

  const porProveedor = useMemo(() => {
    const map: Record<string, { nombre: string; total: number; id: number | null }> = {};
    pagos.forEach(g => {
      const local = toLocal(Number(g.total), g.moneda, Number(g.tasa_cambio || 1), moneda);
      if (!g.contacto_id) {
        if (!map["__sin__"]) map["__sin__"] = { nombre: "—", total: 0, id: null };
        map["__sin__"].total += local;
      } else {
        const nombre = contactos?.find(c => c.id === g.contacto_id)?.nombre;
        if (!nombre) return;
        const key = String(g.contacto_id);
        if (!map[key]) map[key] = { nombre, total: 0, id: g.contacto_id };
        map[key].total += local;
      }
    });
    return Object.entries(map).map(([, { nombre, total, id }]) => [nombre, total, id] as [string, number, number | null]).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [pagos, contactos, moneda]);

  const maxIngCat  = Math.max(...porCategoriaIngresos.map(([, v]) => v), 1);
  const maxGastoCat = Math.max(...porCategoriaGastos.map(([, v]) => v), 1);
  const maxProv    = Math.max(...porProveedor.map(([, v]) => v), 1);

  const getContacto = (id?: number | null) => contactos?.find(c => c.id === id)?.nombre ?? "";
  const getCuenta   = (id?: string | null) => cuentas?.find(c => c.id === id)?.nombre ?? "";

  function exportXLSX() {
    type Row = { Tipo: string; Fecha: string; Concepto: string; Categoría: string; Contacto: string; Cuenta: string; Moneda: string; Monto: number; "Tipo de cambio": number; [k: string]: unknown; "Nro. comprobante": string };
    const rows: Row[] = [];
    ingresos.forEach(i => rows.push({ Tipo: "Ingreso", Fecha: i.fecha, Concepto: i.concepto ?? "", Categoría: i.categoria ?? "", Contacto: getContacto(i.contacto_id), Cuenta: getCuenta(i.cuenta_id), Moneda: i.moneda, Monto: Number(i.monto), "Tipo de cambio": Number(i.tasa_cambio || 1), [`Monto ${moneda}`]: toLocal(Number(i.monto), i.moneda, Number(i.tasa_cambio || 1), moneda), "Nro. comprobante": i.referencia ?? "" }));
    pagos.forEach(g => {
      const fps: { factura_id: number; numero_factura: string | null }[] = Array.isArray(g.factura_pagos) ? g.factura_pagos : [];
      const esPagoFactura = fps.length > 0;
      const conceptoText = esPagoFactura ? fps.map(fp => fp.numero_factura ?? `#${fp.factura_id}`).join(", ") : (Array.isArray(g.items) && g.items.length > 0 ? (g.items as { concepto_nombre?: string }[]).map(it => it.concepto_nombre).filter(Boolean).join(", ") : g.concepto ?? "");
      let categoriaText = g.categoria ?? "";
      if (esPagoFactura) {
        const uniqueConcepts = new Set<string>();
        for (const fp of fps) { const items = (facturaItemsMap[fp.factura_id] ?? []) as { concepto_nombre?: string }[]; for (const item of items) { if (item.concepto_nombre) uniqueConcepts.add(item.concepto_nombre); } }
        if (uniqueConcepts.size > 0) categoriaText = [...uniqueConcepts].join(", ");
      }
      rows.push({ Tipo: esPagoFactura ? "Pago de factura" : "Pago sin factura", Fecha: g.fecha, Concepto: conceptoText, Categoría: categoriaText, Contacto: getContacto(g.contacto_id), Cuenta: getCuenta(g.cuenta_id), Moneda: g.moneda, Monto: -Number(g.total), "Tipo de cambio": Number(g.tasa_cambio || 1), [`Monto ${moneda}`]: -toLocal(Number(g.total), g.moneda, Number(g.tasa_cambio || 1), moneda), "Nro. comprobante": "" });
    });
    notas.filter(n => n.tipo === "emitida").forEach(n => rows.push({ Tipo: "Nota cred. emitida", Fecha: n.fecha, Concepto: n.concepto ?? "", Categoría: n.motivo ?? "", Contacto: getContacto(n.contacto_id), Cuenta: "", Moneda: n.moneda, Monto: Number(n.monto), "Tipo de cambio": Number(n.tasa_cambio || 1), [`Monto ${moneda}`]: toLocal(Number(n.monto), n.moneda, Number(n.tasa_cambio || 1), moneda), "Nro. comprobante": n.numero ?? "" }));
    rows.sort((a, b) => a.Fecha.localeCompare(b.Fecha));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 36 }, { wch: 32 }, { wch: 24 }, { wch: 20 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reporte");
    XLSX.writeFile(wb, `reporte_${desde}_a_${hasta}.xlsx`);
  }

  return (
    <>
      <PageHeader title="Reporte de gastos" description="Análisis del periodo seleccionado" action={<button className="btn btn-primary" onClick={exportXLSX}><Download className="w-4 h-4" /> Exportar XLSX</button>} />

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
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <KPICard label="Total ingresos" value={totalIngresos} moneda={moneda} locale={country.locale} icon={<TrendingUp className="w-5 h-5" />} color="text-green-600" bg="bg-green-50" />
            <KPICard label="Total gastos"   value={totalGastos}   moneda={moneda} locale={country.locale} icon={<TrendingDown className="w-5 h-5" />} color="text-red-600"   bg="bg-red-50" />
            <KPICard label="Balance" value={balance} moneda={moneda} locale={country.locale} icon={<Wallet className="w-5 h-5" />} color={balance >= 0 ? "text-teal-600" : "text-red-600"} bg={balance >= 0 ? "bg-teal-50" : "bg-red-50"} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <BarCard title="Ingresos por categoría" rows={porCategoriaIngresos} max={maxIngCat} moneda={moneda} locale={country.locale} barClass="bg-green-500" />
            <BarCard title="Gastos por concepto"    rows={porCategoriaGastos}  max={maxGastoCat} moneda={moneda} locale={country.locale} barClass="bg-red-500" />
          </div>

          <BarCard title="Top proveedores (por gasto)" rows={porProveedor.map(([n, v]) => [n, v])} hrefs={porProveedor.map(([, , id]) => id != null ? `/contactos/${id}` : undefined)} max={maxProv} moneda={moneda} locale={country.locale} barClass="bg-indigo-500" />
        </>
      )}
    </>
  );
}

function KPICard({ label, value, moneda, locale, icon, color, bg }: { label: string; value: number; moneda: CurrencyCode; locale: string; icon: React.ReactNode; color: string; bg: string }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-[var(--muted)]">{label}</span>
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${bg} ${color}`}>{icon}</span>
      </div>
      <div className="text-2xl font-semibold">{formatMoney(value, moneda, locale)}</div>
    </div>
  );
}

function BarCard({ title, rows, max, moneda, locale, barClass, hrefs }: { title: string; rows: [string, number][]; max: number; moneda: CurrencyCode; locale: string; barClass: string; hrefs?: (string | undefined)[] }) {
  return (
    <div className="card">
      <h3 className="font-semibold mb-4">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-[var(--muted)] py-4">Sin datos en el periodo seleccionado.</p> : (
        <div className="space-y-3">
          {rows.map(([label, value], i) => (
            <div key={label}>
              <div className="flex justify-between text-sm mb-1">
                {hrefs?.[i] ? <Link href={hrefs[i]!} className="truncate max-w-[70%] hover:underline hover:text-[var(--primary)]">{label}</Link> : <span className="truncate max-w-[70%]">{label}</span>}
                <span className="font-medium">{formatMoney(value, moneda, locale)}</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full ${barClass} rounded-full`} style={{ width: `${(value / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
