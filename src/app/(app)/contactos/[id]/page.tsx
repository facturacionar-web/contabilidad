"use client";
import { use, useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useTable,
  updateRow,
  deleteRow,
  paisFilter,
} from "@/lib/useSupabaseData";
import { createClient } from "@/lib/supabase/client";
import type { Gasto, GastoEstado } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import { CurrencyCode } from "@/lib/countries";
import { formatMoney, formatDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import {
  ArrowLeft,
  Plus,
  Receipt,
  CreditCard,
  Pencil,
  Trash2,
  FileMinus,
} from "lucide-react";

type Tab = "facturas" | "pagos";

export default function ContactoDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const contactoId = Number(id);
  const { config, country } = useConfig();
  const pais = config?.pais;
  const base = config?.moneda_base ?? "MXN";

  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() =>
    searchParams.get("tab") === "pagos" ? "pagos" : "facturas"
  );

  useEffect(() => {
    if (searchParams.get("tab") === "pagos") setTab("pagos");
  }, [searchParams]);

  const { data: contactos } = useTable("contactos", {
    orderBy: "nombre",
    ascending: true,
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });
  const { data: gastos, reload } = useTable("gastos", {
    orderBy: "fecha",
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });
  const { data: notas } = useTable("notas_credito", {
    orderBy: "fecha",
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });

  const contacto = contactos?.find((c) => c.id === contactoId);

  const facturas = useMemo(
    () =>
      (gastos ?? []).filter(
        (g) => g.contacto_id === contactoId && g.tipo === "factura_proveedor"
      ),
    [gastos, contactoId]
  );

  const pagos = useMemo(
    () =>
      (gastos ?? []).filter(
        (g) => g.contacto_id === contactoId && g.tipo === "gasto"
      ),
    [gastos, contactoId]
  );

  const notasRecibidas = useMemo(
    () =>
      (notas ?? []).filter(
        (n) => n.contacto_id === contactoId && n.tipo === "recibida"
      ),
    [notas, contactoId]
  );

  const porPagar = facturas
    .filter((f) => f.moneda === base && f.estado !== "pagado")
    .reduce((s, f) => s + (Number(f.total) - Number(f.monto_pagado)), 0);

  const notasPorAplicar = notasRecibidas
    .filter((n) => n.moneda === base && !n.gasto_relacionado_id)
    .reduce((s, n) => s + Number(n.monto), 0);

  const cashPaidByFactura = useMemo(() => {
    const map: Record<number, number> = {};
    for (const pago of pagos) {
      for (const fp of (pago.factura_pagos ?? [])) {
        map[fp.factura_id] = Math.round(((map[fp.factura_id] ?? 0) + Number(fp.monto)) * 100) / 100;
      }
    }
    return map;
  }, [pagos]);

  const creditByFactura = useMemo(() => {
    const map: Record<number, number> = {};
    for (const nota of notasRecibidas) {
      if (nota.gasto_relacionado_id) {
        map[nota.gasto_relacionado_id] = Math.round(((map[nota.gasto_relacionado_id] ?? 0) + Number(nota.monto)) * 100) / 100;
      }
    }
    return map;
  }, [notasRecibidas]);

  async function removeGasto(g: Gasto) {
    if (g.tipo === "factura_proveedor" && Number(g.monto_pagado) > 0) {
      alert("No se puede eliminar una factura con pagos o notas de crédito registrados.");
      return;
    }
    if (!confirm("¿Eliminar este registro?")) return;
    try {
      if (g.tipo === "gasto") {
        const supabase = createClient();
        const fps = g.factura_pagos ?? [];
        for (const fp of fps) {
          const { data: factura } = await supabase.from("gastos").select("*").eq("id", fp.factura_id).single();
          if (!factura) continue;
          const nuevo_pagado = Math.max(0, Math.round((Number(factura.monto_pagado) - Number(fp.monto)) * 100) / 100);
          const total_factura = Math.round(Number(factura.total) * 100) / 100;
          const nuevo_estado: GastoEstado = nuevo_pagado <= 0 ? "pendiente" : nuevo_pagado >= total_factura ? "pagado" : "parcial";
          await updateRow("gastos", fp.factura_id, { monto_pagado: nuevo_pagado, estado: nuevo_estado });
        }
      }
      await deleteRow("gastos", g.id);
      await reload();
    } catch (err) {
      alert("Error: " + (err as Error).message);
    }
  }

  if (contactos && !contacto) {
    return (
      <>
        <PageHeader title="Contacto no encontrado" />
        <Link
          href="/contactos"
          className="text-sm text-[var(--primary)] hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" /> Volver a contactos
        </Link>
      </>
    );
  }

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

  return (
    <>
      <Link
        href="/contactos"
        className="text-sm text-[var(--muted)] hover:text-[var(--primary)] inline-flex items-center gap-1 mb-2"
      >
        <ArrowLeft className="w-4 h-4" /> Contactos
      </Link>

      <PageHeader
        title={contacto?.nombre ?? "…"}
        description={
          contacto?.tax_id
            ? `${contacto.tipo} · ${contacto.tax_id}`
            : contacto?.tipo
        }
        action={
          <Link
            href={`/egresos/facturas?nuevo=1&proveedor=${contactoId}`}
            className="btn btn-primary"
          >
            <Plus className="w-4 h-4" /> Nueva factura de proveedor
          </Link>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <SummaryCard
          icon={<FileMinus className="w-4 h-4" />}
          label="Por pagar"
          value={formatMoney(porPagar, base as CurrencyCode, country.locale)}
          tone="amber"
        />
        <SummaryCard
          icon={<Receipt className="w-4 h-4" />}
          label="Notas crédito por aplicar"
          value={formatMoney(
            notasPorAplicar,
            base as CurrencyCode,
            country.locale
          )}
          tone="teal"
        />
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="border-b border-[var(--border)] flex items-center justify-between pr-4">
          <div className="flex">
            <TabButton active={tab === "facturas"} onClick={() => setTab("facturas")}>
              Facturas ({facturas.length})
            </TabButton>
            <TabButton active={tab === "pagos"} onClick={() => setTab("pagos")}>
              Pagos ({pagos.length})
            </TabButton>
          </div>
          {tab === "pagos" && (
            <Link
              href={`/egresos/pagos?nuevo=1&proveedor=${contactoId}`}
              className="btn btn-primary btn-sm text-xs py-1.5 px-3"
            >
              <Plus className="w-3.5 h-3.5" /> Nuevo pago
            </Link>
          )}
        </div>

        {tab === "facturas" ? (
          facturas.length === 0 ? (
            <EmptyState
              icon={<Receipt className="w-6 h-6" />}
              title="Sin facturas"
              description="Aún no hay facturas registradas para este proveedor."
              action={
                <Link
                  href={`/egresos/facturas?nuevo=1&proveedor=${contactoId}`}
                  className="btn btn-primary"
                >
                  <Plus className="w-4 h-4" /> Nueva factura
                </Link>
              }
            />
          ) : (
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>N° Factura</th>
                  <th>Creación</th>
                  <th>Vencimiento</th>
                  <th>Estado</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Pagado</th>
                  <th className="text-right">Por pagar</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {facturas.map((g) => (
                  <tr key={g.id}>
                    <td className="font-medium whitespace-nowrap">
                      {g.numero_factura || "—"}
                    </td>
                    <td className="whitespace-nowrap text-[var(--muted)]">
                      {formatDate(g.fecha, country.locale)}
                    </td>
                    <td className="whitespace-nowrap text-[var(--muted)]">
                      {g.fecha_vencimiento ? formatDate(g.fecha_vencimiento, country.locale) : "—"}
                    </td>
                    <td>{estadoBadge(g.estado)}</td>
                    <td className="text-right font-semibold text-red-600 whitespace-nowrap">
                      {formatMoney(Number(g.total), g.moneda, country.locale)}
                    </td>
                    <td className="text-right text-[var(--muted)] whitespace-nowrap">
                      {formatMoney(cashPaidByFactura[g.id] ?? 0, g.moneda, country.locale)}
                    </td>
                    <td className="text-right font-medium text-amber-600 whitespace-nowrap">
                      {formatMoney(
                        Math.max(0, Math.round((Number(g.total) - (cashPaidByFactura[g.id] ?? 0) - (creditByFactura[g.id] ?? 0)) * 100) / 100),
                        g.moneda,
                        country.locale
                      )}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {g.estado !== "pagado" && (
                        <Link
                          className="btn btn-ghost p-1.5 text-blue-600"
                          href={`/egresos/pagos?nuevo=1&proveedor=${contactoId}&factura=${g.id}`}
                          title="Agregar pago"
                        >
                          <CreditCard className="w-4 h-4" />
                        </Link>
                      )}
                      {Number(g.monto_pagado) > 0 ? (
                        <>
                          <button className="btn btn-ghost p-1.5 opacity-30 cursor-not-allowed" disabled title="Tiene pagos o notas de crédito registrados"><Pencil className="w-4 h-4" /></button>
                          <button className="btn btn-ghost p-1.5 text-red-600 opacity-30 cursor-not-allowed" disabled title="Tiene pagos o notas de crédito registrados"><Trash2 className="w-4 h-4" /></button>
                        </>
                      ) : (
                        <>
                          <Link className="btn btn-ghost p-1.5" href={`/egresos/facturas?editar=${g.id}`} title="Editar"><Pencil className="w-4 h-4" /></Link>
                          <button className="btn btn-ghost p-1.5 text-red-600" onClick={() => removeGasto(g)} title="Eliminar"><Trash2 className="w-4 h-4" /></button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : pagos.length === 0 ? (
          <EmptyState
            icon={<CreditCard className="w-6 h-6" />}
            title="Sin pagos"
            description="No hay pagos registrados para este proveedor."
            action={
              <Link href={`/egresos/pagos?nuevo=1&proveedor=${contactoId}`} className="btn btn-primary">
                <Plus className="w-4 h-4" /> Nuevo pago
              </Link>
            }
          />
        ) : (
          <table className="table text-sm">
            <thead>
              <tr>
                <th className="text-center w-10">#</th>
                <th>Fecha</th>
                <th>Detalle</th>
                <th>Método</th>
                <th className="text-right">Monto</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pagos.map((g) => {
                const fps = g.factura_pagos ?? [];
                return (
                  <tr key={g.id}>
                    <td className="text-center text-[var(--muted)] font-medium">{g.id}</td>
                    <td className="whitespace-nowrap">{formatDate(g.fecha, country.locale)}</td>
                    <td className="max-w-xs">
                      {fps.length > 0 ? (
                        <div className="space-y-0.5">
                          {fps.map((fp, i) => (
                            <div key={i}>
                              <span className="font-medium">{fp.numero_factura ?? `#${fp.factura_id}`}</span>
                              <span className="text-[var(--muted)] ml-2">{formatMoney(fp.monto, g.moneda, country.locale)}</span>
                              {fp.retenciones?.length > 0 && (
                                <span className="text-xs text-amber-600 ml-2">
                                  (ret: {fp.retenciones.map(r => `${r.tipo} ${formatMoney(r.monto, g.moneda, country.locale)}`).join(", ")})
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[var(--muted)]">{g.concepto}</span>
                      )}
                    </td>
                    <td className="text-[var(--muted)]">{g.metodo_pago ?? "—"}</td>
                    <td className="text-right font-semibold text-red-600 whitespace-nowrap">
                      {formatMoney(Number(g.total), g.moneda, country.locale)}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <Link className="btn btn-ghost p-1.5" href={`/egresos/pagos?editar=${g.id}`} title="Editar pago">
                        <Pencil className="w-4 h-4" />
                      </Link>
                      <button className="btn btn-ghost p-1.5 text-red-600" onClick={() => removeGasto(g)}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "amber" | "teal";
}) {
  const bg = tone === "amber" ? "bg-amber-50" : "bg-teal-50";
  const fg = tone === "amber" ? "text-amber-600" : "text-teal-600";
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-[var(--muted)]">{label}</span>
        <span
          className={`w-9 h-9 rounded-lg flex items-center justify-center ${bg} ${fg}`}
        >
          {icon}
        </span>
      </div>
      <div className={`text-2xl font-semibold ${fg}`}>{value}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-[var(--primary)] text-[var(--primary-hover)]"
          : "border-transparent text-[var(--muted)] hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}
