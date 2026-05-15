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
import EntityMeta from "@/components/EntityMeta";
import { ArrowLeft, CreditCard, Receipt } from "lucide-react";
import { CONCEPTO_ID_DIFERENCIA_TASA } from "@/lib/concepts";

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
  const [diferenciaTasa, setDiferenciaTasa] = useState<number>(0);

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
    // Cargar gasto subordinado de diferencia de tasa (si existe).
    supabase
      .from("gastos")
      .select("total")
      .eq("concepto_id", CONCEPTO_ID_DIFERENCIA_TASA)
      .like("notas", `[diff-tasa:pago-${pagoId}]%`)
      .is("deleted_at", null)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setDiferenciaTasa(Number(data.total) || 0);
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

  // Totales de facturas aplicadas en este pago
  const totalesFacturas = useMemo(() => {
    const subtotal = fps.reduce((s, fp) => s + Number(fp.monto), 0);
    const retenido = fps.reduce(
      (s, fp) => s + (fp.retenciones ?? []).reduce((sr, r) => sr + Number(r.monto || 0), 0),
      0
    );
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      retenido: Math.round(retenido * 100) / 100,
      total: Math.round((subtotal - retenido) * 100) / 100,
    };
  }, [fps]);

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

      <EntityMeta entity="gastos" entityId={pago.id} variant="block" className="mb-4 -mt-4" />

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
          {esPagoFactura && totalesFacturas.retenido > 0 ? (
            <>
              <div className="flex justify-between text-xs text-[var(--muted)]">
                <span>Subtotal</span>
                <span>{formatMoney(totalesFacturas.subtotal, pago.moneda, country.locale)}</span>
              </div>
              <div className="flex justify-between text-xs text-amber-600 mt-0.5">
                <span>Importe retenido</span>
                <span>− {formatMoney(totalesFacturas.retenido, pago.moneda, country.locale)}</span>
              </div>
              <div className="flex justify-between items-baseline mt-1.5 pt-1.5 border-t border-[var(--border)]">
                <span className="text-xs text-[var(--muted)]">Total</span>
                <span className="text-xl font-bold text-red-600">
                  {formatMoney(totalesFacturas.total, pago.moneda, country.locale)}
                </span>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-[var(--muted)] mb-1">Total pagado</p>
              <p className="text-2xl font-bold text-red-600">
                {formatMoney(Number(pago.total), pago.moneda, country.locale)}
              </p>
            </>
          )}
          {isForeign && tasa > 1 && (
            <p className="text-xs text-amber-700 mt-1">
              ≈ {formatMoney((esPagoFactura ? totalesFacturas.total : Number(pago.total)) * tasa + diferenciaTasa, base, country.locale)}
              {" "}(1 {pago.moneda} = {tasa} {base}{diferenciaTasa > 0 ? ` + ${formatMoney(diferenciaTasa, base, country.locale)} dif. tasa` : ""})
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
                <th className="text-left px-5 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">N° Factura</th>
                <th className="text-left px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide whitespace-nowrap">Fecha</th>
                <th className="text-left px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide whitespace-nowrap">Vencimiento</th>
                <th className="text-right px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide whitespace-nowrap">Total</th>
                <th className="text-right px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide whitespace-nowrap">Ya pagado</th>
                <th className="text-right px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide whitespace-nowrap">Por pagar</th>
                <th className="text-left px-4 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide">Retenciones</th>
                <th className="text-right px-5 py-2.5 font-medium text-[var(--muted)] text-xs uppercase tracking-wide whitespace-nowrap">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {fps.map((fp) => {
                const factura = todasLasFacturas?.find((f) => f.id === fp.factura_id);
                const porPagarAntes = Number(fp.total_factura) - Number(fp.monto_pagado_antes);
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
                    <td className="px-4 py-3 text-[var(--muted)] whitespace-nowrap">
                      {factura ? formatDate(factura.fecha, country.locale) : "—"}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)] whitespace-nowrap">
                      {factura?.fecha_vencimiento ? formatDate(factura.fecha_vencimiento, country.locale) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {formatMoney(fp.total_factura, pago.moneda, country.locale)}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--muted)] whitespace-nowrap">
                      {formatMoney(fp.monto_pagado_antes, pago.moneda, country.locale)}
                    </td>
                    <td className="px-4 py-3 text-right text-amber-600 whitespace-nowrap">
                      {formatMoney(Math.max(0, porPagarAntes), pago.moneda, country.locale)}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)] text-xs">
                      {fp.retenciones && fp.retenciones.length > 0
                        ? fp.retenciones
                            .map((r) => `${r.tipo}: ${formatMoney(r.monto, pago.moneda, country.locale)}`)
                            .join(", ")
                        : "—"}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold whitespace-nowrap">
                      {formatMoney(fp.monto, pago.moneda, country.locale)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-[var(--border)] bg-[var(--surface-2)]">
              <tr>
                <td colSpan={7} className="px-5 py-2 text-right text-sm text-[var(--muted)]">
                  Subtotal
                </td>
                <td className="px-5 py-2 text-right font-medium whitespace-nowrap">
                  {formatMoney(totalesFacturas.subtotal, pago.moneda, country.locale)}
                </td>
              </tr>
              {totalesFacturas.retenido > 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-2 text-right text-sm text-[var(--muted)]">
                    Importe retenido
                  </td>
                  <td className="px-5 py-2 text-right font-medium text-amber-600 whitespace-nowrap">
                    − {formatMoney(totalesFacturas.retenido, pago.moneda, country.locale)}
                  </td>
                </tr>
              )}
              <tr className="bg-[var(--surface-hover)]">
                <td colSpan={7} className="px-5 py-2.5 text-right font-semibold text-[var(--foreground)]">
                  Total {pago.moneda}
                </td>
                <td className="px-5 py-2.5 text-right font-bold text-base text-red-500 whitespace-nowrap">
                  {formatMoney(totalesFacturas.total, pago.moneda, country.locale)}
                </td>
              </tr>
              {diferenciaTasa > 0 && (
                <tr className="bg-amber-500/5">
                  <td colSpan={7} className="px-5 py-2 text-right text-sm text-amber-600">
                    Diferencia de tasa de cambio
                  </td>
                  <td className="px-5 py-2 text-right font-medium text-amber-600 whitespace-nowrap">
                    + {formatMoney(diferenciaTasa, base, country.locale)}
                  </td>
                </tr>
              )}
              {isForeign && tasa > 1 && (
                <tr className="bg-amber-50">
                  <td colSpan={7} className="px-5 py-2 text-right text-sm text-amber-700">
                    Total {base} (1 {pago.moneda} = {tasa} {base})
                  </td>
                  <td className="px-5 py-2 text-right font-bold text-amber-700 whitespace-nowrap">
                    {formatMoney(totalesFacturas.total * tasa + diferenciaTasa, base, country.locale)}
                  </td>
                </tr>
              )}
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
            <tfoot className="border-t-2 border-[var(--border)] bg-[var(--surface-hover)]">
              <tr>
                <td className="px-5 py-2.5 text-right font-semibold text-[var(--muted)]">
                  Total
                </td>
                <td className="px-5 py-2.5 text-right font-bold text-base text-red-500">
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
