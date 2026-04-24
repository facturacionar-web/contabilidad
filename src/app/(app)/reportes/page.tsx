"use client";
import { useState, useMemo } from "react";
import { useTable, paisFilter } from "@/lib/useSupabaseData";
import { useConfig } from "@/lib/useConfig";
import { CurrencyCode } from "@/lib/countries";
import { formatMoney, todayISO } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { Download, TrendingUp, TrendingDown, Wallet } from "lucide-react";
import Link from "next/link";

function firstDayOfMonth() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function toLocal(amount: number, entryMoneda: string, tasa: number, localMoneda: string): number {
  if (entryMoneda === localMoneda) return amount;
  return amount * (tasa || 1);
}

export default function ReportesPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const moneda = (config?.moneda_base ?? "ARS") as CurrencyCode;
  const [desde, setDesde] = useState(firstDayOfMonth());
  const [hasta, setHasta] = useState(todayISO());

  const { data: allIngresos } = useTable("ingresos", { orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: allGastos } = useTable("gastos", { orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: allNotas } = useTable("notas_credito", { orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: contactos } = useTable("contactos", { orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais] });

  const ingresos = useMemo(
    () => (allIngresos ?? []).filter((r) => r.fecha >= desde && r.fecha <= hasta),
    [allIngresos, desde, hasta]
  );
  const gastos = useMemo(
    () => (allGastos ?? []).filter((r) => r.fecha >= desde && r.fecha <= hasta),
    [allGastos, desde, hasta]
  );
  const notas = useMemo(
    () => (allNotas ?? []).filter((r) => r.fecha >= desde && r.fecha <= hasta),
    [allNotas, desde, hasta]
  );

  // Map factura id → items (from ALL gastos, not date-filtered, for concept lookup)
  const facturaItemsMap = useMemo(() => {
    const map: Record<number, { concepto_nombre?: string; total?: number }[]> = {};
    (allGastos ?? []).forEach((g) => {
      if (g.tipo === "factura_proveedor" && g.id) {
        map[g.id] = Array.isArray(g.items) ? g.items : [];
      }
    });
    return map;
  }, [allGastos]);

  // Pagos (tipo="gasto") = actual cash outflows, with the correct exchange rate at payment time
  const pagos = useMemo(() => gastos.filter((g) => g.tipo === "gasto"), [gastos]);

  const totalIngresos = useMemo(
    () => ingresos.reduce((s, i) => s + toLocal(Number(i.monto), i.moneda, Number(i.tasa_cambio || 1), moneda), 0),
    [ingresos, moneda]
  );
  const totalGastos = useMemo(
    () => pagos.reduce((s, g) => s + toLocal(Number(g.total), g.moneda, Number(g.tasa_cambio || 1), moneda), 0),
    [pagos, moneda]
  );
  const balance = totalIngresos - totalGastos;

  const porCategoriaIngresos = useMemo(() => {
    const map: Record<string, number> = {};
    ingresos.forEach((i) => {
      const key = i.categoria || "Sin categoría";
      map[key] = (map[key] ?? 0) + toLocal(Number(i.monto), i.moneda, Number(i.tasa_cambio || 1), moneda);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [ingresos, moneda]);

  const porCategoriaGastos = useMemo(() => {
    const map: Record<string, number> = {};
    pagos.forEach((g) => {
      const tasa = Number(g.tasa_cambio || 1);
      const fpList: { factura_id?: number; monto?: number }[] = Array.isArray(g.factura_pagos) ? g.factura_pagos : [];

      if (fpList.length > 0) {
        // Pago linked to facturas — distribute amount across factura concepts
        for (const fp of fpList) {
          if (!fp.factura_id) continue;
          const fpLocal = toLocal(Number(fp.monto ?? 0), g.moneda, tasa, moneda);
          const items = facturaItemsMap[fp.factura_id] ?? [];
          const itemsTotal = items.reduce((s, it) => s + Number(it.total ?? 0), 0);
          if (items.length > 0 && itemsTotal > 0) {
            items.forEach((item) => {
              const key = item.concepto_nombre || "Sin categoría";
              map[key] = (map[key] ?? 0) + fpLocal * (Number(item.total) / itemsTotal);
            });
          }
        }
        // Direct lines added on the pago itself
        const directItems: { concepto_nombre?: string; total?: number }[] = Array.isArray(g.items) ? g.items : [];
        directItems.forEach((item) => {
          if (item.concepto_nombre) {
            map[item.concepto_nombre] = (map[item.concepto_nombre] ?? 0) + toLocal(Number(item.total ?? 0), g.moneda, tasa, moneda);
          }
        });
      } else if (g.concepto_id) {
        // Standalone pago with a concept
        const key = g.categoria || "Sin categoría";
        map[key] = (map[key] ?? 0) + toLocal(Number(g.total), g.moneda, tasa, moneda);
      }
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [pagos, facturaItemsMap, moneda]);

  const porProveedor = useMemo(() => {
    const map: Record<number, { nombre: string; total: number }> = {};
    pagos.forEach((g) => {
      if (!g.contacto_id) return;
      const nombre = contactos?.find((c) => c.id === g.contacto_id)?.nombre ?? "—";
      if (!map[g.contacto_id]) map[g.contacto_id] = { nombre, total: 0 };
      map[g.contacto_id].total += toLocal(Number(g.total), g.moneda, Number(g.tasa_cambio || 1), moneda);
    });
    return Object.entries(map)
      .map(([id, { nombre, total }]) => [nombre, total, Number(id)] as [string, number, number])
      .sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [pagos, contactos, moneda]);

  const maxIngCat = Math.max(...porCategoriaIngresos.map(([, v]) => v), 1);
  const maxGastoCat = Math.max(...porCategoriaGastos.map(([, v]) => v), 1);
  const maxProv = Math.max(...porProveedor.map(([, v]) => v), 1);

  const getContacto = (id?: number | null) =>
    contactos?.find((c) => c.id === id)?.nombre ?? "";

  function exportCSV() {
    const rows: string[] = [];
    rows.push("Tipo,Fecha,Concepto,Categoria,Contacto,Moneda,Monto,TasaCambio,MontoPesos,Estado,Numero");

    ingresos.forEach((i) => {
      rows.push(
        [
          "Ingreso",
          i.fecha,
          csvEsc(i.concepto),
          csvEsc(i.categoria),
          csvEsc(getContacto(i.contacto_id)),
          i.moneda,
          Number(i.monto),
          Number(i.tasa_cambio || 1),
          toLocal(Number(i.monto), i.moneda, Number(i.tasa_cambio || 1), moneda),
          "",
          csvEsc(i.referencia ?? ""),
        ].join(",")
      );
    });
    gastos.filter((g) => g.tipo !== "gasto" || !g.factura_pagos).forEach((g) => {
      rows.push(
        [
          g.tipo === "factura_proveedor" ? "Factura prov." : "Gasto",
          g.fecha,
          csvEsc(g.concepto),
          csvEsc(g.categoria),
          csvEsc(getContacto(g.contacto_id)),
          g.moneda,
          -Number(g.total),
          Number(g.tasa_cambio || 1),
          -toLocal(Number(g.total), g.moneda, Number(g.tasa_cambio || 1), moneda),
          g.estado,
          csvEsc(g.numero_factura ?? ""),
        ].join(",")
      );
    });
    notas.forEach((n) => {
      rows.push(
        [
          n.tipo === "emitida" ? "Nota cred. emitida" : "Nota cred. recibida",
          n.fecha,
          csvEsc(n.concepto),
          csvEsc(n.motivo),
          csvEsc(getContacto(n.contacto_id)),
          n.moneda,
          Number(n.monto),
          Number(n.tasa_cambio || 1),
          toLocal(Number(n.monto), n.moneda, Number(n.tasa_cambio || 1), moneda),
          "",
          csvEsc(n.numero ?? ""),
        ].join(",")
      );
    });

    const blob = new Blob(["\uFEFF" + rows.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte_${desde}_a_${hasta}_${moneda}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="Reportes"
        description="Análisis del periodo seleccionado"
        action={
          <button className="btn btn-primary" onClick={exportCSV}>
            <Download className="w-4 h-4" /> Exportar CSV
          </button>
        }
      />

      <div className="card mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Desde</label>
            <input
              type="date"
              className="input"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Hasta</label>
            <input
              type="date"
              className="input"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <button
              className="btn btn-secondary w-full"
              onClick={() => {
                setDesde(firstDayOfMonth());
                setHasta(todayISO());
              }}
            >
              Este mes
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <KPICard
          label="Total ingresos"
          value={totalIngresos}
          moneda={moneda}
          locale={country.locale}
          icon={<TrendingUp className="w-5 h-5" />}
          color="text-green-600"
          bg="bg-green-50"
        />
        <KPICard
          label="Total gastos"
          value={totalGastos}
          moneda={moneda}
          locale={country.locale}
          icon={<TrendingDown className="w-5 h-5" />}
          color="text-red-600"
          bg="bg-red-50"
        />
        <KPICard
          label="Balance"
          value={balance}
          moneda={moneda}
          locale={country.locale}
          icon={<Wallet className="w-5 h-5" />}
          color={balance >= 0 ? "text-teal-600" : "text-red-600"}
          bg={balance >= 0 ? "bg-teal-50" : "bg-red-50"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <BarCard
          title="Ingresos por categoría"
          rows={porCategoriaIngresos}
          max={maxIngCat}
          moneda={moneda}
          locale={country.locale}
          barClass="bg-green-500"
        />
        <BarCard
          title="Gastos por concepto"
          rows={porCategoriaGastos}
          max={maxGastoCat}
          moneda={moneda}
          locale={country.locale}
          barClass="bg-red-500"
        />
      </div>

      <BarCard
        title="Top proveedores (por gasto)"
        rows={porProveedor.map(([n, v]) => [n, v])}
        hrefs={porProveedor.map(([, , id]) => `/contactos/${id}`)}
        max={maxProv}
        moneda={moneda}
        locale={country.locale}
        barClass="bg-indigo-500"
      />
    </>
  );
}

function csvEsc(s: string) {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function KPICard({
  label,
  value,
  moneda,
  locale,
  icon,
  color,
  bg,
}: {
  label: string;
  value: number;
  moneda: CurrencyCode;
  locale: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
}) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-[var(--muted)]">{label}</span>
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${bg} ${color}`}>
          {icon}
        </span>
      </div>
      <div className="text-2xl font-semibold">
        {formatMoney(value, moneda, locale)}
      </div>
    </div>
  );
}

function BarCard({
  title,
  rows,
  max,
  moneda,
  locale,
  barClass,
  hrefs,
}: {
  title: string;
  rows: [string, number][];
  max: number;
  moneda: CurrencyCode;
  locale: string;
  barClass: string;
  hrefs?: string[];
}) {
  return (
    <div className="card">
      <h3 className="font-semibold mb-4">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)] py-4">
          Sin datos en el periodo seleccionado.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map(([label, value], i) => (
            <div key={label}>
              <div className="flex justify-between text-sm mb-1">
                {hrefs?.[i]
                  ? <Link href={hrefs[i]} className="truncate max-w-[70%] hover:underline hover:text-[var(--primary)]">{label}</Link>
                  : <span className="truncate max-w-[70%]">{label}</span>}
                <span className="font-medium">
                  {formatMoney(value, moneda, locale)}
                </span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full ${barClass} rounded-full`}
                  style={{ width: `${(value / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
