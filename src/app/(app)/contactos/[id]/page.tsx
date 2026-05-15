"use client";
import { use, useMemo, useState, useEffect, useCallback, Fragment } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useTable,
  updateRow,
  deleteRow,
  paisFilter,
  cascadeAnticiposBeforeDeleteGasto,
} from "@/lib/useSupabaseData";
import { createClient } from "@/lib/supabase/client";
import type { Gasto, GastoEstado, Ingreso, NotaCredito } from "@/lib/types";
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
  RotateCcw,
  TrendingUp,
  ArrowUpRight,
  X,
  Loader2,
  Wallet,
} from "lucide-react";

type Tab = "facturas" | "pagos" | "notas" | "pagos-recibidos" | "anticipos";

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
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get("tab");
    if (t === "pagos") return "pagos";
    if (t === "notas") return "notas";
    if (t === "pagos-recibidos") return "pagos-recibidos";
    if (t === "anticipos") return "anticipos";
    return "facturas";
  });

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "pagos") setTab("pagos");
    else if (t === "notas") setTab("notas");
    else if (t === "pagos-recibidos") setTab("pagos-recibidos");
    else if (t === "anticipos") setTab("anticipos");
  }, [searchParams]);

  const { data: contactos } = useTable("contactos", {
    orderBy: "nombre",
    ascending: true,
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });
  const { data: gastos, reload, loading: loadingGastos } = useTable("gastos", {
    orderBy: "fecha",
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });
  const { data: notas, reload: reloadNotas, loading: loadingNotas } = useTable("notas_credito", {
    orderBy: "fecha",
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });
  const { data: ingresos, reload: reloadIngresos, loading: loadingIngresos } = useTable("ingresos", {
    orderBy: "fecha",
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });
  const { data: conceptos } = useTable("conceptos", {
    orderBy: "nombre",
    ascending: true,
    filter: paisFilter(pais),
    skip: !pais,
    deps: [pais],
  });

  // Aplicaciones de anticipos
  type AnticipoAp = { id: number; anticipo_pago_id: number; factura_id: number; monto: number; fecha: string; notas: string | null };
  const [aplicaciones, setAplicaciones] = useState<AnticipoAp[]>([]);
  const reloadAplicaciones = useCallback(async () => {
    if (!pais) return;
    const sb = createClient();
    const { data } = await sb.from("anticipos_aplicaciones").select("*").eq("ctx_pais", pais);
    setAplicaciones((data ?? []) as AnticipoAp[]);
  }, [pais]);
  useEffect(() => { reloadAplicaciones(); }, [reloadAplicaciones]);

  // Cuando cambia la tab, refrescar los datos de esa sección
  useEffect(() => {
    if (!pais) return;
    if (tab === "facturas") reload();
    else if (tab === "pagos") reload();
    else if (tab === "notas") reloadNotas();
    else if (tab === "pagos-recibidos") reloadIngresos();
    else if (tab === "anticipos") { reload(); reloadAplicaciones(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, pais]);

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

  const pagosRecibidos = useMemo(
    () => (ingresos ?? []).filter((i) => i.contacto_id === contactoId),
    [ingresos, contactoId]
  );

  // ── Anticipos del proveedor ───────────────────────────────────────────
  const conceptosAnticipo = useMemo(
    () => new Set((conceptos ?? []).filter(c => c.es_anticipo).map(c => c.id)),
    [conceptos]
  );
  type AnticipoRow = {
    pago: Gasto;
    total: number;
    aplicado: number;
    saldo: number;
  };
  const anticipos: AnticipoRow[] = useMemo(() => {
    const list: AnticipoRow[] = [];
    for (const p of pagos) {
      const items = (p.items ?? []) as { concepto_id?: string | null }[];
      const tieneConceptoAnticipo =
        (p.concepto_id && conceptosAnticipo.has(p.concepto_id)) ||
        items.some(it => it.concepto_id && conceptosAnticipo.has(it.concepto_id));
      if (!tieneConceptoAnticipo) continue;
      const total = Number(p.total);
      const aplicado = aplicaciones
        .filter(a => a.anticipo_pago_id === p.id)
        .reduce((s, a) => s + Number(a.monto), 0);
      const saldo = Math.max(0, Math.round((total - aplicado) * 100) / 100);
      list.push({ pago: p, total, aplicado, saldo });
    }
    return list.sort((a, b) => b.pago.fecha.localeCompare(a.pago.fecha));
  }, [pagos, conceptosAnticipo, aplicaciones]);

  const anticiposPorMoneda = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of anticipos) {
      m[a.pago.moneda] = (m[a.pago.moneda] ?? 0) + a.saldo;
    }
    return m;
  }, [anticipos]);

  // Anticipos aplicados por factura (para descontar en "Por pagar")
  const anticipoByFactura = useMemo(() => {
    const map: Record<number, number> = {};
    for (const ap of aplicaciones) {
      map[ap.factura_id] = Math.round(((map[ap.factura_id] ?? 0) + Number(ap.monto)) * 100) / 100;
    }
    return map;
  }, [aplicaciones]);

  // "Por pagar" total expresado en moneda base. Las facturas en moneda
  // distinta se convierten con su propia tasa_cambio (la que cargó el user
  // al crear la factura — no la del día).
  const porPagar = facturas
    .filter((f) => f.estado !== "pagado")
    .reduce((s, f) => {
      const pendiente = Number(f.total) - Number(f.monto_pagado);
      const tasa = f.moneda === base ? 1 : Number(f.tasa_cambio || 1);
      return s + pendiente * tasa;
    }, 0);

  // "Notas crédito por aplicar" idem: convierto cada nota a moneda base.
  const notasPorAplicar = notasRecibidas
    .filter((n) => {
      if (n.gasto_relacionado_id) return false;
      const aps = ((n as unknown as { factura_aplicaciones?: unknown[] }).factura_aplicaciones ?? []);
      if (aps.length > 0) return false;
      try { if (JSON.parse(n.motivo || "")?.ingreso_id) return false; } catch { /* ok */ }
      return true;
    })
    .reduce((s, n) => {
      const monto = Number(n.monto);
      const tasa = n.moneda === base ? 1 : Number(n.tasa_cambio || 1);
      return s + monto * tasa;
    }, 0);

  // Monto bruto aplicado a la factura (incluye retenciones que van al gobierno).
  // Se usa para calcular "Por pagar" — porque desde el lado de la factura, las retenciones
  // sí saldan parte de la deuda con el proveedor.
  const cashPaidByFactura = useMemo(() => {
    const map: Record<number, number> = {};
    for (const pago of pagos) {
      for (const fp of (pago.factura_pagos ?? [])) {
        map[fp.factura_id] = Math.round(((map[fp.factura_id] ?? 0) + Number(fp.monto)) * 100) / 100;
      }
    }
    return map;
  }, [pagos]);

  // Monto efectivamente pagado al proveedor (monto - retenciones).
  // Se muestra en la columna "Pagado" para reflejar lo que realmente salió del banco.
  const efectivoPagadoByFactura = useMemo(() => {
    const map: Record<number, number> = {};
    for (const pago of pagos) {
      for (const fp of (pago.factura_pagos ?? [])) {
        const ret = (fp.retenciones ?? []).reduce((s, r) => s + Number(r.monto || 0), 0);
        const neto = Number(fp.monto) - ret;
        map[fp.factura_id] = Math.round(((map[fp.factura_id] ?? 0) + neto) * 100) / 100;
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

  function calcAplicado(n: NotaCredito): number {
    type AP = { monto: number };
    const aps = ((n as unknown as { factura_aplicaciones?: AP[] }).factura_aplicaciones ?? []);
    let aplicado = aps.reduce((s, a) => s + Number(a.monto), 0);
    if (aps.length === 0 && n.gasto_relacionado_id) aplicado = Number(n.monto);
    try {
      const mot = JSON.parse(n.motivo || "");
      if (mot?.devolucion?.monto) aplicado += Number(mot.devolucion.monto);
    } catch { /* ok */ }
    return Math.min(Math.round(aplicado * 100) / 100, Number(n.monto));
  }

  async function removeNota(n: NotaCredito) {
    if (!confirm("¿Eliminar esta nota de crédito?")) return;
    try {
      // Delete linked devolucion ingreso
      try {
        const mot = JSON.parse(n.motivo || "");
        if (mot?.ingreso_id) await deleteRow("ingresos", mot.ingreso_id);
      } catch { /* ok */ }
      // Revert factura_aplicaciones
      type AP = { factura_id: number; monto: number };
      const aps = ((n as unknown as { factura_aplicaciones?: AP[] }).factura_aplicaciones ?? []);
      if (aps.length > 0) {
        for (const ap of aps) {
          const fac = (gastos ?? []).find(g => g.id === ap.factura_id);
          if (!fac) continue;
          const revertido = Math.max(0, Math.round((Number(fac.monto_pagado) - ap.monto) * 100) / 100);
          const total = Math.round(Number(fac.total) * 100) / 100;
          const estado: GastoEstado = revertido <= 0 ? "pendiente" : revertido >= total ? "pagado" : "parcial";
          await updateRow("gastos", ap.factura_id, { monto_pagado: revertido, estado });
        }
      } else if (n.gasto_relacionado_id) {
        const fac = (gastos ?? []).find(g => g.id === n.gasto_relacionado_id);
        if (fac) {
          const revertido = Math.max(0, Math.round((Number(fac.monto_pagado) - Number(n.monto)) * 100) / 100);
          const total = Math.round(Number(fac.total) * 100) / 100;
          const estado: GastoEstado = revertido <= 0 ? "pendiente" : revertido >= total ? "pagado" : "parcial";
          await updateRow("gastos", n.gasto_relacionado_id, { monto_pagado: revertido, estado });
        }
      }
      await deleteRow("notas_credito", n.id);
      await reloadNotas();
      await reload();
    } catch (err) {
      alert("Error: " + (err as Error).message);
    }
  }

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
      await cascadeAnticiposBeforeDeleteGasto(g.id);
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

      {loadingGastos || loadingNotas || loadingIngresos ? (
        <div className="card flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--muted)]" />
        </div>
      ) : (
        <>
      <div className={`grid grid-cols-1 ${anticipos.length > 0 ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-4 mb-6`}>
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
        {anticipos.length > 0 && (
          <SummaryCard
            icon={<ArrowUpRight className="w-4 h-4" />}
            label={`Anticipos sin aplicar (${anticipos.filter(a => a.saldo > 0).length})`}
            value={Object.entries(anticiposPorMoneda)
              .map(([m, v]) => formatMoney(v, m as CurrencyCode, country.locale))
              .join(" / ") || formatMoney(0, base as CurrencyCode, country.locale)}
            tone="blue"
          />
        )}
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
            <TabButton active={tab === "notas"} onClick={() => setTab("notas")}>
              Notas de crédito ({notasRecibidas.length})
            </TabButton>
            <TabButton active={tab === "pagos-recibidos"} onClick={() => setTab("pagos-recibidos")}>
              Pagos recibidos ({pagosRecibidos.length})
            </TabButton>
            {anticipos.length > 0 && (
              <TabButton active={tab === "anticipos"} onClick={() => setTab("anticipos")}>
                Anticipos ({anticipos.length})
              </TabButton>
            )}
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
            <table className="table text-sm w-full">
              <colgroup>
                <col />
                <col style={{ width: "1%" }} />
                <col style={{ width: "1%" }} />
                <col style={{ width: "1%" }} />
                <col style={{ width: "1%" }} />
                <col style={{ width: "1%" }} />
                <col style={{ width: "1%" }} />
                <col style={{ width: "1%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>N° Factura</th>
                  <th className="whitespace-nowrap">Creación</th>
                  <th className="whitespace-nowrap">Vencimiento</th>
                  <th>Estado</th>
                  <th className="text-right whitespace-nowrap">Total</th>
                  <th className="text-right whitespace-nowrap">Pagado</th>
                  <th className="text-right whitespace-nowrap">Por pagar</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {facturas.map((g) => (
                  <tr key={g.id}>
                    <td className="font-medium whitespace-nowrap">
                      <Link
                        href={`/egresos/facturas/${g.id}`}
                        className="hover:underline hover:text-[var(--primary)]"
                      >
                        {g.numero_factura || `#${g.id}`}
                      </Link>
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
                      {formatMoney(efectivoPagadoByFactura[g.id] ?? 0, g.moneda, country.locale)}
                    </td>
                    <td className="text-right font-medium text-amber-600 whitespace-nowrap">
                      {formatMoney(
                        Math.max(0, Math.round((Number(g.total) - (cashPaidByFactura[g.id] ?? 0) - (creditByFactura[g.id] ?? 0) - (anticipoByFactura[g.id] ?? 0)) * 100) / 100),
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
        ) : tab === "pagos" ? (
          pagos.length === 0 ? (
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
                    <td className="text-center font-medium">
                      <Link href={`/egresos/pagos/${g.id}`} className="hover:underline hover:text-[var(--primary)] text-[var(--muted)]">
                        {g.id}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">{formatDate(g.fecha, country.locale)}</td>
                    <td className="max-w-xs">
                      {fps.length > 0 ? (
                        <div className="space-y-0.5">
                          {fps.map((fp, i) => (
                            <div key={i}>
                              <span className="font-medium">{fp.numero_factura ?? `#${fp.factura_id}`}</span>
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
          )
        ) : tab === "notas" ? (
          notasRecibidas.length === 0 ? (
            <EmptyState
              icon={<RotateCcw className="w-6 h-6" />}
              title="Sin notas de crédito"
              description="No hay notas de crédito registradas para este proveedor."
            />
          ) : (
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Número</th>
                  <th>Concepto</th>
                  <th>Facturas aplicadas</th>
                  <th className="text-right">Monto</th>
                  <th className="text-right">Aplicado</th>
                  <th className="text-right">Por aplicar</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {notasRecibidas.map((n) => {
                  const aps = ((n as unknown as { factura_aplicaciones?: { numero_factura: string | null; factura_id: number }[] }).factura_aplicaciones ?? []);
                  let hasDevolucion = false;
                  try { hasDevolucion = !!JSON.parse(n.motivo || "")?.ingreso_id; } catch { /* ok */ }
                  const aplicado = calcAplicado(n);
                  const porAplicar = Math.max(0, Math.round((Number(n.monto) - aplicado) * 100) / 100);
                  return (
                    <tr key={n.id}>
                      <td className="whitespace-nowrap">{formatDate(n.fecha, country.locale)}</td>
                      <td className="text-[var(--muted)]">{n.numero || "—"}</td>
                      <td className="font-medium max-w-xs truncate">{n.concepto}</td>
                      <td className="text-[var(--muted)]">
                        {aps.length > 0
                          ? aps.map(a => a.numero_factura ?? `#${a.factura_id}`).join(", ")
                          : n.gasto_relacionado_id
                            ? `#${n.gasto_relacionado_id}`
                            : hasDevolucion
                              ? <span className="text-teal-600 text-xs">Devolución de dinero</span>
                              : <span className="text-amber-600 text-xs">Sin asignar</span>}
                      </td>
                      <td className="text-right font-semibold whitespace-nowrap">
                        {formatMoney(Number(n.monto), n.moneda as CurrencyCode, country.locale)}
                      </td>
                      <td className="text-right text-[var(--muted)] whitespace-nowrap">
                        {formatMoney(aplicado, n.moneda as CurrencyCode, country.locale)}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {porAplicar > 0.005
                          ? <span className="text-amber-600 font-medium">{formatMoney(porAplicar, n.moneda as CurrencyCode, country.locale)}</span>
                          : <span className="text-teal-600 text-xs">Aplicado</span>}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <Link className="btn btn-ghost p-1.5" href={`/ingresos/notas-credito?editar=${n.id}`} title="Editar">
                          <Pencil className="w-4 h-4" />
                        </Link>
                        <button className="btn btn-ghost p-1.5 text-red-600" onClick={() => removeNota(n)} title="Eliminar">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : tab === "pagos-recibidos" ? (
          pagosRecibidos.length === 0 ? (
            <EmptyState
              icon={<TrendingUp className="w-6 h-6" />}
              title="Sin pagos recibidos"
              description="No hay pagos recibidos registrados para este contacto."
            />
          ) : (
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Concepto</th>
                  <th>Método</th>
                  <th className="text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {pagosRecibidos.map((i: Ingreso) => (
                  <tr key={i.id}>
                    <td className="whitespace-nowrap">{formatDate(i.fecha, country.locale)}</td>
                    <td className="font-medium max-w-xs truncate">{i.concepto}</td>
                    <td className="text-[var(--muted)]">{i.metodo_pago || "—"}</td>
                    <td className="text-right font-semibold text-teal-600 whitespace-nowrap">
                      {formatMoney(Number(i.monto), i.moneda as CurrencyCode, country.locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : tab === "anticipos" ? (
          anticipos.length === 0 ? (
            <EmptyState
              icon={<Wallet className="w-6 h-6" />}
              title="Sin anticipos"
              description="No hay anticipos registrados para este proveedor. Los pagos hechos con un concepto marcado como 'anticipo' aparecerán acá."
            />
          ) : (
            <AnticiposSection
              anticipos={anticipos}
              facturas={facturas.filter(f => f.estado !== "pagado")}
              aplicaciones={aplicaciones}
              locale={country.locale}
              onChange={async () => { await reloadAplicaciones(); await reload(); }}
              ctxPais={pais ?? null}
            />
          )
        ) : null}
      </div>
        </>
      )}
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
  tone: "amber" | "teal" | "blue";
}) {
  const bg = tone === "amber" ? "bg-amber-50" : tone === "blue" ? "bg-blue-50" : "bg-teal-50";
  const fg = tone === "amber" ? "text-amber-600" : tone === "blue" ? "text-blue-600" : "text-teal-600";
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

// ── Sección de Anticipos ───────────────────────────────────────────────
type AnticipoApRow = { id: number; anticipo_pago_id: number; factura_id: number; monto: number; fecha: string; notas: string | null };
type AnticipoEntry = {
  pago: Gasto;
  total: number;
  aplicado: number;
  saldo: number;
};

function AnticiposSection({
  anticipos,
  facturas,
  aplicaciones,
  locale,
  onChange,
  ctxPais,
}: {
  anticipos: AnticipoEntry[];
  facturas: Gasto[];
  aplicaciones: AnticipoApRow[];
  locale: string;
  onChange: () => Promise<void>;
  ctxPais: string | null;
}) {
  const [applyingFor, setApplyingFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function applyAnticipo(anticipo: AnticipoEntry, facturaId: number, monto: number) {
    if (monto <= 0) { alert("El monto debe ser mayor a 0"); return; }
    if (monto > anticipo.saldo + 0.001) { alert(`No podés aplicar más que el saldo disponible (${anticipo.saldo}).`); return; }
    const factura = facturas.find(f => f.id === facturaId);
    if (!factura) { alert("Factura no encontrada"); return; }
    if (factura.moneda !== anticipo.pago.moneda) {
      if (!confirm(`La moneda del anticipo (${anticipo.pago.moneda}) no coincide con la de la factura (${factura.moneda}). ¿Aplicar igual?`)) return;
    }
    const porPagarFactura = Number(factura.total) - Number(factura.monto_pagado);
    if (monto > porPagarFactura + 0.001) {
      if (!confirm(`El monto excede lo que falta pagar de la factura (${porPagarFactura}). ¿Aplicar igual y dejar un saldo a favor?`)) return;
    }

    setBusy(true);
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("No autenticado");
      const effectiveId = (user.user_metadata?.owner_id as string | undefined) ?? user.id;

      // 1) Insertar la aplicación
      const { error: e1 } = await sb.from("anticipos_aplicaciones").insert({
        user_id: effectiveId,
        ctx_pais: ctxPais,
        anticipo_pago_id: anticipo.pago.id,
        factura_id: facturaId,
        monto,
        fecha: new Date().toISOString().slice(0, 10),
      } as never);
      if (e1) throw new Error(e1.message);

      // 2) Actualizar monto_pagado y estado de la factura
      const nuevoPagado = Math.round((Number(factura.monto_pagado) + monto) * 100) / 100;
      const totalFactura = Number(factura.total);
      const nuevoEstado: GastoEstado = nuevoPagado >= totalFactura - 0.001 ? "pagado"
        : nuevoPagado > 0 ? "parcial"
        : "pendiente";
      await updateRow("gastos", facturaId, { monto_pagado: nuevoPagado, estado: nuevoEstado });

      await onChange();
      setApplyingFor(null);
    } catch (e) {
      alert("Error: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unapplyAnticipo(ap: AnticipoApRow) {
    if (!confirm("¿Revertir esta aplicación? El monto vuelve al anticipo y se descuenta de la factura.")) return;
    setBusy(true);
    try {
      const sb = createClient();
      // 1) Revertir monto_pagado de la factura
      const { data: facturaRow } = await sb.from("gastos").select("*").eq("id", ap.factura_id).single();
      if (facturaRow) {
        const f = facturaRow as Gasto;
        const nuevoPagado = Math.max(0, Math.round((Number(f.monto_pagado) - Number(ap.monto)) * 100) / 100);
        const total = Number(f.total);
        const nuevoEstado: GastoEstado = nuevoPagado <= 0 ? "pendiente"
          : nuevoPagado >= total - 0.001 ? "pagado"
          : "parcial";
        await updateRow("gastos", ap.factura_id, { monto_pagado: nuevoPagado, estado: nuevoEstado });
      }
      // 2) Borrar la aplicación
      const { error } = await sb.from("anticipos_aplicaciones").delete().eq("id", ap.id);
      if (error) throw new Error(error.message);

      await onChange();
    } catch (e) {
      alert("Error: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {(
        <table className="table text-sm">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Concepto</th>
              <th className="text-right">Monto</th>
              <th className="text-right">Aplicado</th>
              <th className="text-right">Saldo</th>
              <th className="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {anticipos.map(a => {
              const apsDelAnticipo = aplicaciones.filter(x => x.anticipo_pago_id === a.pago.id);
              const isApplying = applyingFor === a.pago.id;
              return (
                <Fragment key={a.pago.id}>
                  <tr className={a.saldo <= 0 ? "opacity-60" : ""}>
                    <td className="whitespace-nowrap text-[var(--muted)]">{formatDate(a.pago.fecha, locale)}</td>
                    <td className="font-medium">
                      <Link href={`/egresos/pagos/${a.pago.id}`} className="hover:text-[var(--primary)] hover:underline">
                        {a.pago.concepto}
                      </Link>
                    </td>
                    <td className="text-right font-semibold whitespace-nowrap">
                      {formatMoney(a.total, a.pago.moneda, locale)}
                    </td>
                    <td className="text-right text-[var(--muted)] whitespace-nowrap">
                      {formatMoney(a.aplicado, a.pago.moneda, locale)}
                    </td>
                    <td className={`text-right font-bold whitespace-nowrap ${a.saldo > 0 ? "text-blue-600" : "text-[var(--muted)]"}`}>
                      {formatMoney(a.saldo, a.pago.moneda, locale)}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {a.saldo > 0 && (
                        <button
                          onClick={() => setApplyingFor(isApplying ? null : a.pago.id)}
                          className="btn btn-ghost p-1.5 text-blue-600"
                          title="Aplicar a factura"
                        >
                          <ArrowUpRight className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                  {/* Lista de aplicaciones existentes */}
                  {apsDelAnticipo.map(ap => {
                    const factura = facturas.find(f => f.id === ap.factura_id);
                    return (
                      <tr key={ap.id} className="bg-slate-50/60 text-xs">
                        <td></td>
                        <td colSpan={3} className="text-[var(--muted)] pl-8">
                          Aplicado a {factura ? `Factura ${factura.numero_factura ?? `#${factura.id}`}` : `Factura #${ap.factura_id}`} · {formatDate(ap.fecha, locale)}
                        </td>
                        <td className="text-right font-medium text-blue-600">
                          {formatMoney(Number(ap.monto), a.pago.moneda, locale)}
                        </td>
                        <td className="text-right">
                          <button
                            onClick={() => unapplyAnticipo(ap)}
                            disabled={busy}
                            className="btn btn-ghost p-1.5 text-red-600"
                            title="Revertir aplicación"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {/* Form para aplicar */}
                  {isApplying && (
                    <tr className="bg-blue-50/30">
                      <td colSpan={6} className="px-4 py-3">
                        <ApplyForm
                          anticipo={a}
                          facturas={facturas.filter(f => Number(f.total) > Number(f.monto_pagado))}
                          locale={locale}
                          busy={busy}
                          onCancel={() => setApplyingFor(null)}
                          onApply={(facturaId, monto) => applyAnticipo(a, facturaId, monto)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ApplyForm({
  anticipo,
  facturas,
  locale,
  busy,
  onCancel,
  onApply,
}: {
  anticipo: AnticipoEntry;
  facturas: Gasto[];
  locale: string;
  busy: boolean;
  onCancel: () => void;
  onApply: (facturaId: number, monto: number) => void;
}) {
  const [facturaId, setFacturaId] = useState<number | "">("");
  const [monto, setMonto] = useState<number>(anticipo.saldo);

  // Cuando elige una factura, sugerir min(saldo anticipo, lo que falta pagar)
  function onSelectFactura(id: string) {
    const fid = Number(id);
    setFacturaId(fid);
    const f = facturas.find(x => x.id === fid);
    if (f) {
      const porPagar = Number(f.total) - Number(f.monto_pagado);
      setMonto(Math.min(anticipo.saldo, porPagar));
    }
  }

  if (facturas.length === 0) {
    return (
      <div className="text-sm text-[var(--muted)]">
        No hay facturas pendientes de este proveedor a las que aplicar el anticipo.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[240px]">
        <label className="label text-xs">Aplicar a factura</label>
        <select className="select text-sm py-1.5" value={facturaId} onChange={e => onSelectFactura(e.target.value)}>
          <option value="">— Elegir factura —</option>
          {facturas.map(f => {
            const porPagar = Number(f.total) - Number(f.monto_pagado);
            return (
              <option key={f.id} value={f.id}>
                {f.numero_factura ?? `#${f.id}`} · {formatDate(f.fecha, locale)} · falta {formatMoney(porPagar, f.moneda, locale)}
              </option>
            );
          })}
        </select>
      </div>
      <div className="w-36">
        <label className="label text-xs">Monto a aplicar</label>
        <input
          type="number"
          step="0.01"
          min="0"
          max={anticipo.saldo}
          className="input text-sm py-1.5"
          value={monto || ""}
          onChange={e => setMonto(parseFloat(e.target.value) || 0)}
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => facturaId !== "" && onApply(Number(facturaId), monto)}
          disabled={busy || facturaId === "" || monto <= 0}
          className="btn btn-primary text-sm"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpRight className="w-4 h-4" />}
          Aplicar
        </button>
        <button onClick={onCancel} disabled={busy} className="btn btn-secondary text-sm">
          Cancelar
        </button>
      </div>
    </div>
  );
}
