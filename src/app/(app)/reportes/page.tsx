"use client";
import { useState, useMemo, useEffect } from "react";
import { useTable, paisFilter } from "@/lib/useSupabaseData";
import { useConfig } from "@/lib/useConfig";
import { CURRENCIES, CurrencyCode } from "@/lib/countries";
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

export default function ReportesPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const [desde, setDesde] = useState(firstDayOfMonth());
  const [hasta, setHasta] = useState(todayISO());
  const [moneda, setMoneda] = useState<CurrencyCode>("MXN");

  // Sync moneda with config once loaded
  useEffect(() => {
    if (config?.moneda_base) setMoneda(config.moneda_base);
  }, [config?.moneda_base]);

  const { data: allIngresos } = useTable("ingresos", { orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: allGastos } = useTable("gastos", { orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: allNotas } = useTable("notas_credito", { orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais] });
  const { data: contactos } = useTable("contactos", { orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais] });

  // Filter by date range in memory
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

  const ingresosMoneda = ingresos.filter((i) => i.moneda === moneda);
  const gastosMoneda = gastos.filter((g) => g.moneda === moneda);
  const notasMoneda = notas.filter((n) => n.moneda === moneda);

  const totalIngresos = ingresosMoneda.reduce((s, i) => s + Number(i.monto), 0);
  const totalGastos = gastosMoneda.reduce((s, g) => s + Number(g.total), 0);
  const balance = totalIngresos - totalGastos;

  const porCategoriaIngresos = useMemo(() => {
    const map: Record<string, number> = {};
    ingresosMoneda.forEach((i) => {
      map[i.categoria] = (map[i.categoria] ?? 0) + Number(i.monto);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [ingresosMoneda]);

  const porCategoriaGastos = useMemo(() => {
    const map: Record<string, number> = {};
    gastosMoneda.forEach((g) => {
      map[g.categoria] = (map[g.categoria] ?? 0) + Number(g.total);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [gastosMoneda]);

  const porProveedor = useMemo(() => {
    const map: Record<number, { nombre: string; total: number }> = {};
    gastosMoneda.forEach((g) => {
      if (!g.contacto_id) return;
      const nombre = contactos?.find((c) => c.id === g.contacto_id)?.nombre ?? "—";
      if (!map[g.contacto_id]) map[g.contacto_id] = { nombre, total: 0 };
      map[g.contacto_id].total += Number(g.total);
    });
    return Object.entries(map)
      .map(([id, { nombre, total }]) => [nombre, total, Number(id)] as [string, number, number])
      .sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [gastosMoneda, contactos]);

  const maxIngCat = Math.max(...porCategoriaIngresos.map(([, v]) => v), 1);
  const maxGastoCat = Math.max(...porCategoriaGastos.map(([, v]) => v), 1);
  const maxProv = Math.max(...porProveedor.map(([, v]) => v), 1);

  const getContacto = (id?: number | null) =>
    contactos?.find((c) => c.id === id)?.nombre ?? "";

  function exportCSV() {
    const rows: string[] = [];
    rows.push("Tipo,Fecha,Concepto,Categoria,Contacto,Moneda,Monto,Estado,Numero");

    ingresosMoneda.forEach((i) => {
      rows.push(
        [
          "Ingreso",
          i.fecha,
          csvEsc(i.concepto),
          csvEsc(i.categoria),
          csvEsc(getContacto(i.contacto_id)),
          i.moneda,
          Number(i.monto),
          "",
          csvEsc(i.referencia ?? ""),
        ].join(",")
      );
    });
    gastosMoneda.forEach((g) => {
      rows.push(
        [
          g.tipo === "factura_proveedor" ? "Factura prov." : "Gasto",
          g.fecha,
          csvEsc(g.concepto),
          csvEsc(g.categoria),
          csvEsc(getContacto(g.contacto_id)),
          g.moneda,
          -Number(g.total),
          g.estado,
          csvEsc(g.numero_factura ?? ""),
        ].join(",")
      );
    });
    notasMoneda.forEach((n) => {
      rows.push(
        [
          n.tipo === "emitida" ? "Nota cred. emitida" : "Nota cred. recibida",
          n.fecha,
          csvEsc(n.concepto),
          csvEsc(n.motivo),
          csvEsc(getContacto(n.contacto_id)),
          n.moneda,
          Number(n.monto),
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
          <div>
            <label className="label">Moneda</label>
            <select
              className="select"
              value={moneda}
              onChange={(e) => setMoneda(e.target.value as CurrencyCode)}
            >
              {Object.values(CURRENCIES).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button
              className="btn btn-secondary flex-1"
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
          title="Gastos por categoría"
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
