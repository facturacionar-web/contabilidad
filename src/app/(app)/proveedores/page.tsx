"use client";
import { useState, useMemo } from "react";
import { useTable, paisFilter } from "@/lib/useSupabaseData";
import { useConfig } from "@/lib/useConfig";
import { CurrencyCode } from "@/lib/countries";
import { formatMoney } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import { ChevronDown, ChevronRight, Search, Package } from "lucide-react";
import EmptyState from "@/components/EmptyState";

type ConceptoStat = { total: number; count: number };

const SIN_PROVEEDOR = 0; // sentinel para gastos sin contacto_id

export default function ProveedoresPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const base = (config?.moneda_base ?? "ARS") as CurrencyCode;

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");

  const { data: contactos } = useTable("contactos", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });
  const { data: gastos } = useTable("gastos", {
    orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais],
  });

  const proveedores = useMemo(
    () => (contactos ?? []).filter(c => c.tipo === "proveedor" || c.tipo === "ambos"),
    [contactos]
  );

  // Conceptos reales por proveedor (y sin proveedor), todo convertido a moneda base
  const conceptosPorProveedor = useMemo(() => {
    const result: Record<number, Record<string, ConceptoStat>> = {};

    for (const g of (gastos ?? [])) {
      const contactoKey: number = g.contacto_id ?? SIN_PROVEEDOR;

      const items = Array.isArray(g.items)
        ? (g.items as { concepto_nombre?: string; total?: number }[])
        : [];

      // Detectar si es un pago de factura (tiene factura_pagos)
      const fps = Array.isArray(g.factura_pagos) ? g.factura_pagos : [];
      const esPagoFactura = fps.length > 0;

      // Si es pago de factura o factura_proveedor sin items → saltear
      if (items.length === 0 && (esPagoFactura || g.tipo === "factura_proveedor")) continue;

      const tasa = Number(g.tasa_cambio) || 1;
      if (!result[contactoKey]) result[contactoKey] = {};
      const map = result[contactoKey];

      if (items.length > 0) {
        // Usar líneas detalladas (facturas y pagos directos con items)
        const vistos = new Set<string>();
        for (const item of items) {
          const nombre = item.concepto_nombre?.trim();
          if (!nombre) continue;

          const montoBase = g.moneda === base
            ? Number(item.total ?? 0)
            : Number(item.total ?? 0) * tasa;

          if (!map[nombre]) map[nombre] = { total: 0, count: 0 };
          map[nombre].total += montoBase;

          if (!vistos.has(nombre)) {
            map[nombre].count++;
            vistos.add(nombre);
          }
        }
      } else {
        // Pago directo sin items: usar g.concepto como fallback
        const nombre = (g.concepto as string | undefined)?.trim();
        if (!nombre) continue;

        const montoBase = g.moneda === base
          ? Number(g.total ?? 0)
          : Number(g.total ?? 0) * tasa;

        if (!map[nombre]) map[nombre] = { total: 0, count: 0 };
        map[nombre].total += montoBase;
        map[nombre].count++;
      }
    }
    return result;
  }, [gastos, base]);

  const proveedoresConGastos = useMemo(() =>
    proveedores
      .filter(p => !!conceptosPorProveedor[p.id])
      .filter(p => !search || p.nombre.toLowerCase().includes(search.toLowerCase())),
    [proveedores, conceptosPorProveedor, search]
  );

  // Conceptos sin proveedor asignado
  const conceptosSinProveedor = conceptosPorProveedor[SIN_PROVEEDOR] ?? null;
  const nombresSinProveedor = conceptosSinProveedor ? Object.keys(conceptosSinProveedor).sort() : [];
  const sinProveedorVisible = !!conceptosSinProveedor && (!search || "sin proveedor".includes(search.toLowerCase()));

  function toggle(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const hayDatos = proveedoresConGastos.length > 0 || sinProveedorVisible;

  // Tabla de conceptos reutilizable
  function ConceptosTable({ id, conceptos, nombres, label }: {
    id: number;
    conceptos: Record<string, ConceptoStat>;
    nombres: string[];
    label: string;
  }) {
    return (
      <div className="border-t border-[var(--border)] bg-slate-50/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="text-left px-12 py-2 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
                Concepto
              </th>
              <th className="text-center px-5 py-2 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
                Usos
              </th>
              <th className="text-right px-5 py-2 text-xs font-medium text-[var(--muted)] uppercase tracking-wide">
                Total ({base})
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {nombres.map(nombre => {
              const stat = conceptos[nombre];
              return (
                <tr key={nombre} className="hover:bg-slate-50">
                  <td className="px-12 py-2.5 font-medium">{nombre}</td>
                  <td className="px-5 py-2.5 text-center text-[var(--muted)]">{stat.count}</td>
                  <td className="px-5 py-2.5 text-right font-semibold text-red-600">
                    {formatMoney(stat.total, base, country.locale)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--border)] bg-slate-100/60">
              <td className="px-12 py-2.5 font-semibold text-[var(--muted)]" colSpan={2}>
                Total {label}
              </td>
              <td className="px-5 py-2.5 text-right font-bold text-base text-red-700">
                {formatMoney(nombres.reduce((s, n) => s + conceptos[n].total, 0), base, country.locale)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Gastos por proveedor"
        description="Conceptos utilizados por proveedor en facturas y pagos"
      />

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input pl-9 sm:w-72"
              placeholder="Buscar proveedor…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <span className="text-sm text-[var(--muted)]">
            {proveedoresConGastos.length} proveedor{proveedoresConGastos.length !== 1 ? "es" : ""}
            {sinProveedorVisible && " + sin asignar"}
          </span>
        </div>

        {!hayDatos ? (
          <EmptyState
            icon={<Package className="w-6 h-6" />}
            title="Sin proveedores con movimientos"
            description="Cuando registres facturas o pagos a proveedores, aparecerán aquí con sus conceptos."
          />
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {/* Proveedores con contacto */}
            {proveedoresConGastos.map(p => {
              const conceptos = conceptosPorProveedor[p.id] ?? {};
              const isOpen = expanded.has(p.id);
              const nombres = Object.keys(conceptos).sort();

              return (
                <div key={p.id}>
                  <button
                    className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition-colors text-left"
                    onClick={() => toggle(p.id)}
                  >
                    {isOpen
                      ? <ChevronDown className="w-4 h-4 shrink-0 text-[var(--muted)]" />
                      : <ChevronRight className="w-4 h-4 shrink-0 text-[var(--muted)]" />}
                    <Link
                      href={`/contactos/${p.id}`}
                      className="font-semibold hover:underline hover:text-[var(--primary)]"
                      onClick={e => e.stopPropagation()}
                    >
                      {p.nombre}
                    </Link>
                    {p.tax_id && (
                      <span className="text-xs text-[var(--muted)]">{p.tax_id}</span>
                    )}
                    <span className="ml-auto text-xs text-[var(--muted)]">
                      {nombres.length} concepto{nombres.length !== 1 ? "s" : ""}
                    </span>
                  </button>

                  {isOpen && (
                    <ConceptosTable
                      id={p.id}
                      conceptos={conceptos}
                      nombres={nombres}
                      label={p.nombre}
                    />
                  )}
                </div>
              );
            })}

            {/* Sin proveedor asignado */}
            {sinProveedorVisible && conceptosSinProveedor && (
              <div>
                <button
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition-colors text-left"
                  onClick={() => toggle(SIN_PROVEEDOR)}
                >
                  {expanded.has(SIN_PROVEEDOR)
                    ? <ChevronDown className="w-4 h-4 shrink-0 text-[var(--muted)]" />
                    : <ChevronRight className="w-4 h-4 shrink-0 text-[var(--muted)]" />}
                  <span className="font-semibold text-[var(--muted)] italic">Sin proveedor asignado</span>
                  <span className="ml-auto text-xs text-[var(--muted)]">
                    {nombresSinProveedor.length} concepto{nombresSinProveedor.length !== 1 ? "s" : ""}
                  </span>
                </button>

                {expanded.has(SIN_PROVEEDOR) && (
                  <ConceptosTable
                    id={SIN_PROVEEDOR}
                    conceptos={conceptosSinProveedor}
                    nombres={nombresSinProveedor}
                    label="sin proveedor"
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
