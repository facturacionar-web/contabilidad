"use client";
import { use, useMemo, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useTable, paisFilter } from "@/lib/useSupabaseData";
import type { Gasto, FacturaItem, FacturaPago, GastoEstado } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import { CurrencyCode } from "@/lib/countries";
import { formatMoney, formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import EntityMeta from "@/components/EntityMeta";
import { ArrowLeft, CreditCard, Receipt } from "lucide-react";

export default function FacturaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const facturaId = Number(id);
  const { config, country } = useConfig();
  const pais = config?.pais;
  const base = (config?.moneda_base ?? "ARS") as CurrencyCode;

  const [factura, setFactura] = useState<Gasto | null | undefined>(undefined);

  // Cargar la factura directamente
  useEffect(() => {
    if (!pais) return;
    const supabase = createClient();
    supabase
      .from("gastos")
      .select("*")
      .eq("id", facturaId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) setFactura(null);
        else setFactura(data as Gasto);
      });
  }, [facturaId, pais]);

  // Pagos y notas relacionadas al país (para filtrar los que aplican a esta factura)
  const { data: todosLosPagos } = useTable("gastos", {
    orderBy: "fecha",
    filter: [...(paisFilter(pais) ?? []), { column: "tipo", op: "eq", value: "gasto" }],
    skip: !pais,
    deps: [pais],
  });
  const { data: todasLasNotas } = useTable("notas_credito", {
    orderBy: "fecha",
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });
  const { data: contactos } = useTable("contactos", {
    orderBy: "nombre",
    ascending: true,
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });

  // Pagos que incluyen esta factura
  const pagosDeEstaFactura = useMemo(() => {
    if (!todosLosPagos) return [];
    return todosLosPagos.filter((g) =>
      (g.factura_pagos ?? []).some((fp: FacturaPago) => fp.factura_id === facturaId)
    );
  }, [todosLosPagos, facturaId]);

  // Notas de crédito relacionadas a esta factura
  const notasDeEstaFactura = useMemo(() => {
    if (!todasLasNotas) return [];
    return todasLasNotas.filter(
      (n) =>
        n.gasto_relacionado_id === facturaId ||
        ((n as unknown as { factura_aplicaciones?: { factura_id: number }[] })
          .factura_aplicaciones ?? []
        ).some((a) => a.factura_id === facturaId)
    );
  }, [todasLasNotas, facturaId]);

  const proveedor = contactos?.find((c) => c.id === factura?.contacto_id);

  const items = (factura?.items ?? []) as FacturaItem[];

  const estadoBadge = (e: GastoEstado) => {
    const map: Record<GastoEstado, string> = {
      pagado: "badge-success",
      pendiente: "badge-danger",
      parcial: "badge-warning",
    };
    const label: Record<GastoEstado, string> = {
      pagado: "Pagado",
      pendiente: "Pendiente",
      parcial: "Parcial",
    };
    return <span className={`badge ${map[e]}`}>{label[e]}</span>;
  };

  if (factura === undefined) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--muted)]">
        Cargando…
      </div>
    );
  }

  if (factura === null) {
    return (
      <>
        <PageHeader title="Factura no encontrada" />
        <Link
          href="/egresos/facturas"
          className="text-sm text-[var(--primary)] hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" /> Volver a facturas
        </Link>
      </>
    );
  }

  const isForeign = factura.moneda !== base;
  const tasa = Number((factura as unknown as { tasa_cambio?: number }).tasa_cambio) || 1;

  // Totales calculados desde items (fuente de verdad)
  const subtotalCalc = items.reduce((s, it) => s + Number(it.neto ?? 0), 0);
  const ivaCalc = items.reduce((s, it) => s + Number(it.iva_monto ?? 0), 0);
  const totalCalc = items.reduce((s, it) => s + Number(it.total ?? 0), 0) || Number(factura.total);

  // Monto pagado real (suma de pagos cash)
  const pagadoCash = pagosDeEstaFactura.reduce((s, g) => {
    const fps = (g.factura_pagos ?? []) as FacturaPago[];
    const fp = fps.find((f) => f.factura_id === facturaId);
    return s + Number(fp?.monto ?? 0);
  }, 0);

  // Monto cubierto por notas
  const pagadoNotas = notasDeEstaFactura.reduce((s, n) => {
    type AP = { factura_id: number; monto: number };
    const aps = (
      (n as unknown as { factura_aplicaciones?: AP[] }).factura_aplicaciones ?? []
    ).filter((a) => a.factura_id === facturaId);
    if (aps.length > 0) return s + aps.reduce((ss, a) => ss + Number(a.monto), 0);
    if (n.gasto_relacionado_id === facturaId) return s + Number(n.monto);
    return s;
  }, 0);

  const porPagar = Math.max(
    0,
    Math.round((totalCalc - pagadoCash - pagadoNotas) * 100) / 100
  );

  return (
    <>
      <Link
        href="/egresos/facturas"
        className="text-sm text-[var(--muted)] hover:text-[var(--primary)] inline-flex items-center gap-1 mb-2"
      >
        <ArrowLeft className="w-4 h-4" /> Facturas
      </Link>

      <PageHeader
        title={`Factura ${factura.numero_factura ?? `#${factura.id}`}`}
        description={proveedor?.nombre ?? "Sin proveedor"}
        action={
          factura.estado !== "pagado" ? (
            <Link
              href={
                factura.contacto_id
                  ? `/egresos/pagos?nuevo=1&proveedor=${factura.contacto_id}&factura=${factura.id}`
                  : `/egresos/pagos?nuevo=1&factura=${factura.id}`
              }
              className="btn btn-primary"
            >
              <CreditCard className="w-4 h-4" /> Registrar pago
            </Link>
          ) : undefined
        }
      />

      <EntityMeta entity="gastos" entityId={factura.id} variant="block" className="mb-4 -mt-4" />

      {/* Cabecera: proveedor + estado */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card py-3">
          <p className="text-xs text-[var(--muted)] mb-1">Proveedor</p>
          {proveedor ? (
            <Link
              href={`/contactos/${proveedor.id}`}
              className="font-semibold hover:underline hover:text-[var(--primary)]"
            >
              {proveedor.nombre}
            </Link>
          ) : (
            <p className="font-semibold text-[var(--muted)]">—</p>
          )}
          {proveedor?.tax_id && (
            <p className="text-xs text-[var(--muted)] mt-0.5">{proveedor.tax_id}</p>
          )}
        </div>
        <div className="card py-3">
          <p className="text-xs text-[var(--muted)] mb-1">Fechas</p>
          <p className="text-sm font-medium">
            Emisión: {formatDate(factura.fecha, country.locale)}
          </p>
          {factura.fecha_vencimiento && (
            <p className="text-sm text-amber-600">
              Vence: {formatDate(factura.fecha_vencimiento, country.locale)}
            </p>
          )}
        </div>
        <div className="card py-3">
          <p className="text-xs text-[var(--muted)] mb-1">Estado</p>
          <div className="flex items-center gap-2 mt-1">
            {estadoBadge(factura.estado)}
          </div>
          <div className="mt-2 space-y-0.5 text-xs text-[var(--muted)]">
            <div className="flex justify-between">
              <span>Total</span>
              <span className="font-semibold text-red-600">
                {formatMoney(totalCalc, factura.moneda, country.locale)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Pagado</span>
              <span>{formatMoney(pagadoCash + pagadoNotas, factura.moneda, country.locale)}</span>
            </div>
            {porPagar > 0 && (
              <div className="flex justify-between text-amber-600 font-medium">
                <span>Por pagar</span>
                <span>{formatMoney(porPagar, factura.moneda, country.locale)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Items de la factura */}
      <div className="card p-0 overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-2">
          <Receipt className="w-4 h-4 text-[var(--muted)]" />
          <h3 className="font-semibold text-sm">Detalle de la factura</h3>
        </div>
        {items.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-[var(--border)]">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">
                  Concepto
                </th>
                <th className="text-center px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide w-20">
                  Cant.
                </th>
                <th className="text-right px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide w-32">
                  Precio unit.
                </th>
                <th className="text-center px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide w-20">
                  IVA
                </th>
                <th className="text-right px-5 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide w-36">
                  Subtotal
                </th>
                <th className="text-right px-5 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide w-36">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {items.map((it, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <p className="font-medium">{it.concepto_nombre || "—"}</p>
                    {it.observaciones && (
                      <p className="text-xs text-[var(--muted)] mt-0.5">{it.observaciones}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-[var(--muted)]">
                    {it.cantidad}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(Number(it.precio), factura.moneda, country.locale)}
                  </td>
                  <td className="px-4 py-3 text-center text-[var(--muted)]">
                    {it.impuesto}%
                  </td>
                  <td className="px-5 py-3 text-right text-[var(--muted)]">
                    {formatMoney(Number(it.neto ?? it.precio * it.cantidad), factura.moneda, country.locale)}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold">
                    {formatMoney(Number(it.total), factura.moneda, country.locale)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-[var(--border)]">
              {subtotalCalc > 0 && ivaCalc > 0 && (
                <>
                  <tr className="bg-[var(--surface-2)]">
                    <td colSpan={5} className="px-5 py-2 text-right text-sm text-[var(--muted)]">
                      Subtotal
                    </td>
                    <td className="px-5 py-2 text-right font-medium text-[var(--foreground)]">
                      {formatMoney(subtotalCalc, factura.moneda, country.locale)}
                    </td>
                  </tr>
                  <tr className="bg-[var(--surface-2)]">
                    <td colSpan={5} className="px-5 py-2 text-right text-sm text-[var(--muted)]">
                      IVA
                    </td>
                    <td className="px-5 py-2 text-right font-medium text-[var(--foreground)]">
                      {formatMoney(ivaCalc, factura.moneda, country.locale)}
                    </td>
                  </tr>
                </>
              )}
              <tr className="bg-[var(--surface-hover)]">
                <td colSpan={5} className="px-5 py-2.5 text-right font-semibold text-[var(--foreground)]">
                  Total {factura.moneda}
                </td>
                <td className="px-5 py-2.5 text-right font-bold text-base text-red-500">
                  {formatMoney(totalCalc, factura.moneda, country.locale)}
                </td>
              </tr>
              {isForeign && tasa > 1 && (
                <tr className="bg-amber-50">
                  <td colSpan={5} className="px-5 py-2 text-right text-sm text-amber-700">
                    Total {base} (1 {factura.moneda} = {tasa} {base})
                  </td>
                  <td className="px-5 py-2 text-right font-bold text-amber-700">
                    {formatMoney(totalCalc * tasa, base, country.locale)}
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        ) : (
          <div className="px-5 py-6 text-sm text-[var(--muted)]">
            Sin líneas de detalle registradas.
          </div>
        )}
      </div>

      {/* Pagos aplicados */}
      {pagosDeEstaFactura.length > 0 && (
        <div className="card p-0 overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-[var(--muted)]" />
            <h3 className="font-semibold text-sm">Pagos registrados</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-[var(--border)]">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">
                  Fecha
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">
                  Método
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">
                  Retenciones
                </th>
                <th className="text-right px-5 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">
                  Monto pagado
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {pagosDeEstaFactura.map((g) => {
                const fps = (g.factura_pagos ?? []) as FacturaPago[];
                const fp = fps.find((f) => f.factura_id === facturaId);
                return (
                  <tr key={g.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">{formatDate(g.fecha, country.locale)}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{g.metodo_pago ?? "—"}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {fp?.retenciones && fp.retenciones.length > 0
                        ? fp.retenciones
                            .map(
                              (r) =>
                                `${r.tipo}: ${formatMoney(r.monto, g.moneda, country.locale)}`
                            )
                            .join(", ")
                        : "—"}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-green-700">
                      {formatMoney(Number(fp?.monto ?? 0), g.moneda, country.locale)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Notas de crédito */}
      {notasDeEstaFactura.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--border)]">
            <h3 className="font-semibold text-sm">Notas de crédito aplicadas</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-[var(--border)]">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">
                  Fecha
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">
                  Número
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">
                  Concepto
                </th>
                <th className="text-right px-5 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">
                  Monto
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {notasDeEstaFactura.map((n) => (
                <tr key={n.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">{formatDate(n.fecha, country.locale)}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">{n.numero ?? "—"}</td>
                  <td className="px-4 py-3 font-medium">{n.concepto}</td>
                  <td className="px-5 py-3 text-right font-semibold text-teal-700">
                    {formatMoney(Number(n.monto), n.moneda as CurrencyCode, country.locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {factura.notas && (
        <div className="card mt-6">
          <p className="text-xs text-[var(--muted)] mb-1">Notas</p>
          <p className="text-sm">{factura.notas}</p>
        </div>
      )}
    </>
  );
}
