"use client";
import { use, useMemo, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useTable, paisFilter } from "@/lib/useSupabaseData";
import type { Gasto, FacturaItem, FacturaPago } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import { CurrencyCode } from "@/lib/countries";
import { formatMoney, formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { ArrowLeft, CreditCard, Receipt } from "lucide-react";

export default function PagoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const pagoId = Number(id);
  const { config, country } = useConfig();
  const pais = config?.pais;
  const base = (config?.moneda_base ?? "ARS") as CurrencyCode;

  const [pago, setPago] = useState<Gasto | null | undefined>(undefined);

  useEffect(() => {
    if (!pais) return;
    const supabase = createClient();
    supabase
      .from("gastos")
      .select("*")
      .eq("id", pagoId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) setPago(null);
        else setPago(data as Gasto);
      });
  }, [pagoId, pais]);

  const { data: contactos } = useTable("contactos", {
    orderBy: "nombre", ascending: true,
    filter: paisFilter(pais), skip: !pais, deps: [pais],
  });
  const { data: cuentas } = useTable("cuentas", {
    orderBy: "nombre", ascending: true,
    filter: paisFilter(pais), skip: !pais, deps: [pais],
  });
  // Facturas referenciadas en este pago
  const { data: todasLasFacturas } = useTable("gastos", {
    orderBy: "fecha",
    filter: [...(paisFilter(pais) ?? []), { column: "tipo", op: "eq", value: "factura_proveedor" }],
    skip: !pais, deps: [pais],
  });

  const fps = useMemo(
    () => (pago?.factura_pagos ?? []) as FacturaPago[],
    [pago]
  );

  const facturasReferenciadas = useMemo(() => {
    if (!todasLasFacturas || fps.length === 0) return [];
    return fps
      .map((fp) => ({
        fp,
        factura: todasLasFacturas.find((f) => f.id === fp.factura_id) ?? null,
      }))
      .filter((x) => x.factura !== null);
  }, [todasLasFacturas, fps]);

  const items = useMemo(
    () => (pago ? (pago as unknown as { items?: FacturaItem[] }).items ?? [] : []) as FacturaItem[],
    [pago]
  );

  const proveedor = contactos?.find((c) => c.id === pago?.contacto_id);
  const cuenta = cuentas?.find((c) => c.id === pago?.cuenta_id);
  const isForeign = pago?.moneda !== base;
  const tasa = Number(pago?.tasa_cambio) || 1;

  if (pago === undefined) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--muted)]">
        Cargando…
      </div>
    );
  }

  if (pago === null) {
    return (
      <>
        <PageHeader title="Pago no encontrado" />
        <Link
          href="/egresos/pagos"
          className="text-sm text-[var(--primary)] hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" /> Volver a pagos
        </Link>
      </>
    );
  }

  const esPagoFactura = fps.length > 0;

  return (
    <>
      <Link
        href="/egresos/pagos"
        className="text-sm text-[var(--muted)] hover:text-[var(--primary)] inline-flex items-center gap-1 mb-2"
      >
        <ArrowLeft className="w-4 h-4" /> Pagos
      </Link>

      <PageHeader
        title={`Pago #${pago.id}`}
        description={proveedor?.nombre ?? "Sin proveedor"}
      />

      {/* Resumen */}
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
          <p className="text-xs text-[var(--muted)] mb-1">Fecha y método</p>
          <p className="text-sm font-medium">{formatDate(pago.fecha, country.locale)}</p>
          <p className="text-xs text-[var(--muted)] mt-0.5">{pago.metodo_pago ?? "—"}</p>
          {cuenta && <p className="text-xs text-[var(--muted)] mt-0.5">Cuenta: {cuenta.nombre}</p>}
        </div>

        <div className="card py-3">
          <p className="text-xs text-[var(--muted)] mb-1">Total pagado</p>
          <p className="text-2xl font-bold text-red-600">
            {formatMoney(Number(pago.total), pago.moneda, country.locale)}
          </p>
          {isForeign && tasa > 1 && (
            <p className="text-xs text-amber-700 mt-1">
              ≈ {formatMoney(Number(pago.total) * tasa, base, country.locale)}
              {" "}(1 {pago.moneda} = {tasa} {base})
            </p>
          )}
        </div>
      </div>

      {/* Facturas pagadas */}
      {esPagoFactura && (
        <div className="card p-0 overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-2">
            <Receipt className="w-4 h-4 text-[var(--muted)]" />
            <h3 className="font-semibold text-sm">Facturas incluidas en este pago</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-[var(--border)]">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">
                  N° Factura
                </th>
                <th className="text-right px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">
                  Total factura
                </th>
                <th className="text-right px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">
                  Ya pagado antes
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">
                  Retenciones
                </th>
                <th className="text-right px-5 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">
                  Monto aplicado
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {fps.map((fp) => {
                const factura = todasLasFacturas?.find((f) => f.id === fp.factura_id);
                return (
                  <tr key={fp.factura_id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium">
                      {factura ? (
                        <Link
                          href={`/egresos/facturas/${fp.factura_id}`}
                          className="hover:underline hover:text-[var(--primary)]"
                        >
                          {fp.numero_factura ?? `#${fp.factura_id}`}
                        </Link>
                      ) : (
                        fp.numero_factura ?? `#${fp.factura_id}`
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--muted)]">
                      {formatMoney(fp.total_factura, pago.moneda, country.locale)}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--muted)]">
                      {formatMoney(fp.monto_pagado_antes, pago.moneda, country.locale)}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)] text-xs">
                      {fp.retenciones && fp.retenciones.length > 0
                        ? fp.retenciones
                            .map(
                              (r) =>
                                `${r.tipo}: ${formatMoney(r.monto, pago.moneda, country.locale)}`
                            )
                            .join(", ")
                        : "—"}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-green-700">
                      {formatMoney(fp.monto, pago.moneda, country.locale)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-[var(--border)] bg-slate-100/60">
              <tr>
                <td colSpan={4} className="px-5 py-2.5 text-right font-semibold text-[var(--muted)]">
                  Total pagado
                </td>
                <td className="px-5 py-2.5 text-right font-bold text-base text-red-700">
                  {formatMoney(Number(pago.total), pago.moneda, country.locale)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Líneas directas (pago sin factura) */}
      {!esPagoFactura && items.length > 0 && (
        <div className="card p-0 overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-[var(--muted)]" />
            <h3 className="font-semibold text-sm">Detalle del pago</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-[var(--border)]">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">
                  Concepto
                </th>
                <th className="text-right px-5 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">
                  Monto
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {items.map((it, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium">{it.concepto_nombre || "—"}</td>
                  <td className="px-5 py-3 text-right font-semibold">
                    {formatMoney(Number(it.total ?? it.precio), pago.moneda, country.locale)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-[var(--border)] bg-slate-100/60">
              <tr>
                <td className="px-5 py-2.5 text-right font-semibold text-[var(--muted)]">
                  Total
                </td>
                <td className="px-5 py-2.5 text-right font-bold text-base text-red-700">
                  {formatMoney(Number(pago.total), pago.moneda, country.locale)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Pago sin factura y sin items: mostrar concepto */}
      {!esPagoFactura && items.length === 0 && pago.concepto && (
        <div className="card mb-6">
          <p className="text-xs text-[var(--muted)] mb-1">Concepto</p>
          <p className="font-medium">{pago.concepto}</p>
        </div>
      )}

      {pago.notas && (
        <div className="card">
          <p className="text-xs text-[var(--muted)] mb-1">Notas</p>
          <p className="text-sm">{pago.notas}</p>
        </div>
      )}
    </>
  );
}
