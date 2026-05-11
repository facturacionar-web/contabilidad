"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useTable, insertRow, updateRow, deleteRow, paisFilter, cascadeAnticiposBeforeDeleteGasto } from "@/lib/useSupabaseData";
import { createClient } from "@/lib/supabase/client";
import type { Gasto, GastoEstado, FacturaPago, Retencion, FacturaItem } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import { CURRENCIES, CurrencyCode, PAYMENT_METHODS, monedasDisponibles } from "@/lib/countries";
import { formatMoney, formatDate, todayISO, parseMonto } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import { Plus, CreditCard, Pencil, Trash2, Search, X, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import SearchableSelect from "@/components/SearchableSelect";
import { snapshotPayment, loadConfig, effectiveConfig } from "@/lib/proveedoresConfig";
import TasaCambioButton from "@/components/TasaCambioButton";
import { useSortable } from "@/lib/useSortable";
import SortHeader from "@/components/SortHeader";
import { usePagination } from "@/lib/usePagination";
import Pagination from "@/components/Pagination";
import EntityMeta from "@/components/EntityMeta";
import MoneyInput from "@/components/MoneyInput";

const TIPOS_RETENCION = ["Ganancias", "IIBB", "Otro"];

// ── Local types ────────────────────────────────────────────────────────────
type RetLocal = { key: string; tipo: string; monto: number };

type DirectLine = { key: string; concepto_id: string; monto: number };

type FPLocal = {
  factura_id: number;
  numero_factura: string | null;
  total_factura: number;
  monto_pagado_antes: number;
  monto: number;
  moneda: CurrencyCode;
  retenciones: RetLocal[];
  showRet: boolean;
};

type FormState = {
  fecha: string;
  contacto_id: number | "";
  cuenta_id: string;
  metodo_pago: string;
  moneda: CurrencyCode;
  tasa_cambio: number;
  nota: string;
  facturas_pagadas: FPLocal[];
  lineas_directas: DirectLine[];
};

let _rkey = 0;
const nextRKey = () => String(++_rkey);

function getLastTasa(moneda: string): number {
  if (typeof window === "undefined") return 1;
  const stored = localStorage.getItem(`last_tasa_${moneda}`);
  return stored ? parseFloat(stored) || 1 : 1;
}
function saveLastTasa(moneda: string, tasa: number): void {
  if (typeof window === "undefined" || tasa <= 0) return;
  localStorage.setItem(`last_tasa_${moneda}`, String(tasa));
}

function blank(moneda: CurrencyCode): FormState {
  return {
    fecha: todayISO(), contacto_id: "", cuenta_id: "", metodo_pago: PAYMENT_METHODS[0],
    moneda, tasa_cambio: getLastTasa(moneda), nota: "",
    facturas_pagadas: [],
    lineas_directas: [{ key: nextRKey(), concepto_id: "", monto: 0 }],
  };
}

function pagoToForm(g: Gasto, facturas: Gasto[], conceptos: { id: string; nombre: string }[]): FormState {
  const fps = (g.factura_pagos ?? []).map((fp, i) => ({
    factura_id: fp.factura_id,
    numero_factura: fp.numero_factura,
    total_factura: Number(fp.total_factura),
    monto_pagado_antes: Number(fp.monto_pagado_antes),
    monto: Number(fp.monto),
    moneda: (facturas.find(f => f.id === fp.factura_id)?.moneda ?? g.moneda) as CurrencyCode,
    retenciones: (fp.retenciones ?? []).map((r, j) => ({ key: `${i}-${j}`, tipo: r.tipo, monto: Number(r.monto) })),
    showRet: (fp.retenciones ?? []).length > 0,
  }));
  const rawItems = (g as unknown as { items?: FacturaItem[] }).items;
  const lineas_directas: DirectLine[] = rawItems?.length
    ? rawItems.map((it, i) => ({ key: String(i), concepto_id: it.concepto_id ?? "", monto: Number(it.precio) }))
    : [{ key: "0", concepto_id: g.concepto_id ?? conceptos.find(c => c.nombre === g.concepto)?.id ?? "", monto: fps.length === 0 ? Number(g.total) : 0 }];
  return {
    fecha: g.fecha,
    contacto_id: g.contacto_id ?? "",
    cuenta_id: g.cuenta_id ?? "",
    metodo_pago: g.metodo_pago ?? PAYMENT_METHODS[0],
    moneda: g.moneda,
    tasa_cambio: g.tasa_cambio ?? 1,
    nota: g.notas ?? "",
    facturas_pagadas: fps,
    lineas_directas,
  };
}

// ── Component ──────────────────────────────────────────────────────────────
export default function PagosEgresosPage() {
  const { config, country } = useConfig();
  const pais = config?.pais;
  const base = (config?.moneda_base ?? "ARS") as CurrencyCode;
  const monedas = pais ? monedasDisponibles(pais) : (["ARS"] as CurrencyCode[]);
  const searchParams = useSearchParams();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Gasto | null>(null);
  const [form, setForm] = useState<FormState>(blank(monedas[0] ?? "ARS"));
  const [search, setSearch] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [filtroProveedor, setFiltroProveedor] = useState<number | "">("");
  const [filtroCuenta, setFiltroCuenta] = useState("");
  const [saving, setSaving] = useState(false);
  const autoOpenedRef = useRef(false);
  const autoEditedRef = useRef(false);
  const [preselectedFacturaId, setPreselectedFacturaId] = useState<number | null>(null);
  const preselectedRef = useRef<number | null>(null);
  const [conciliarId, setConciliarId] = useState<number | null>(null);
  // Cuando vinimos de /conciliacion, queremos volver a esa pantalla con la
  // misma cuenta + mes que el usuario estaba mirando para no perder contexto.
  const [volverCuenta, setVolverCuenta] = useState<string | null>(null);
  const [volverMes, setVolverMes] = useState<string | null>(null);
  const [showAllFacturas, setShowAllFacturas] = useState(false);

  function setPreselected(id: number | null) {
    preselectedRef.current = id;
    setPreselectedFacturaId(id);
  }

  const { data: pagos, reload, loading } = useTable("gastos", {
    orderBy: "fecha",
    filter: [...(paisFilter(pais) ?? []), { column: "tipo", op: "eq", value: "gasto" }],
    skip: !pais, deps: [pais],
  });
  const { data: facturas } = useTable("gastos", {
    orderBy: "fecha",
    filter: [...(paisFilter(pais) ?? []), { column: "tipo", op: "eq", value: "factura_proveedor" }],
    skip: !pais, deps: [pais],
  });
  const { data: contactos } = useTable("contactos", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });
  const { data: cuentas } = useTable("cuentas", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });
  const { data: conceptosAll } = useTable("conceptos", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });

  const proveedores = (contactos ?? []).filter(c => c.tipo === "proveedor" || c.tipo === "ambos");
  const conceptos = (conceptosAll ?? []).filter(c => c.tipo === "egreso" || c.tipo === "ambos");

  // Facturas pendientes del proveedor seleccionado, filtradas por moneda del pago
  const facturasPendientes = useMemo(() => {
    if (form.contacto_id === "") return [];
    return (facturas ?? []).filter(f =>
      f.contacto_id === Number(form.contacto_id) &&
      f.estado !== "pagado" &&
      f.moneda === form.moneda
    );
  }, [facturas, form.contacto_id, form.moneda]);

  // Sync facturas_pagadas when contacto changes
  useEffect(() => {
    if (editing) return;
    const preId = preselectedRef.current;
    const preFactura = preId ? facturasPendientes.find(f => f.id === preId) : null;
    const nuevaMoneda = (preFactura?.moneda ?? monedas[0] ?? base) as CurrencyCode;

    // Last payment for this contact → pre-fill cuenta and método
    const lastPago = form.contacto_id !== ""
      ? (pagos ?? [])
          .filter(p => p.contacto_id === Number(form.contacto_id))
          .sort((a, b) => b.fecha.localeCompare(a.fecha))[0]
      : null;

    setForm(f => ({
      ...f,
      moneda: nuevaMoneda,
      tasa_cambio: nuevaMoneda === f.moneda ? f.tasa_cambio : getLastTasa(nuevaMoneda),
      cuenta_id: lastPago?.cuenta_id ?? f.cuenta_id,
      metodo_pago: lastPago?.metodo_pago ?? f.metodo_pago,
      facturas_pagadas: facturasPendientes.map(fac => ({
        factura_id: fac.id,
        numero_factura: fac.numero_factura ?? null,
        total_factura: Number(fac.total),
        monto_pagado_antes: Number(fac.monto_pagado),
        monto: preId && fac.id === preId ? Number(fac.total) - Number(fac.monto_pagado) : 0,
        moneda: fac.moneda as CurrencyCode,
        retenciones: [] as RetLocal[],
        showRet: false,
      })),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.contacto_id, facturasPendientes.length]);

  const hayFiltros = search || fechaDesde || fechaHasta || filtroProveedor !== "" || filtroCuenta;

  const filteredRaw = useMemo(() => (pagos ?? []).filter(g => {
    if (search) {
      const q = search.toLowerCase();
      const fps = g.factura_pagos ?? [];
      const detalle = fps.length > 0
        ? fps.map(fp => fp.numero_factura ?? "").join(" ")
        : g.concepto;
      if (!detalle.toLowerCase().includes(q)) return false;
    }
    if (fechaDesde && g.fecha < fechaDesde) return false;
    if (fechaHasta && g.fecha > fechaHasta) return false;
    if (filtroProveedor !== "" && g.contacto_id !== filtroProveedor) return false;
    if (filtroCuenta && g.cuenta_id !== filtroCuenta) return false;
    return true;
  }), [pagos, search, fechaDesde, fechaHasta, filtroProveedor, filtroCuenta]);

  const { sortBy, sortDir, toggleSort, sorted } = useSortable(filteredRaw, {
    getValue: (g, key) => {
      switch (key) {
        case "id": return Number(g.id);
        case "fecha": return g.fecha;
        case "detalle": {
          const fps = g.factura_pagos ?? [];
          return fps.length > 0 ? fps.map(fp => fp.numero_factura ?? "").join(" ") : g.concepto;
        }
        case "proveedor": return contactos?.find(c => c.id === g.contacto_id)?.nombre ?? "";
        case "cuenta": return cuentas?.find(c => c.id === g.cuenta_id)?.nombre ?? "";
        case "metodo": return g.metodo_pago ?? "";
        case "monto": return Number(g.total);
        default: return "";
      }
    },
    initial: { key: "fecha", dir: "desc" },
  });
  const filtered = sorted ?? filteredRaw;

  const pagination = usePagination(filtered, "pagos", 50);
  const pageRows = pagination.pageRows;

  function limpiarFiltros() {
    setSearch("");
    setFechaDesde("");
    setFechaHasta("");
    setFiltroProveedor("");
    setFiltroCuenta("");
  }

  const isForeign = form.moneda !== base;

  const totals = useMemo(() => {
    const aplicadoFacturas = form.facturas_pagadas.reduce((s, fp) => s + fp.monto, 0);
    const retenciones = form.facturas_pagadas.reduce((s, fp) => s + fp.retenciones.reduce((sr, r) => sr + r.monto, 0), 0);
    const aplicadoLineas = form.lineas_directas.reduce((s, l) => s + l.monto, 0);
    const neto = aplicadoFacturas - retenciones + aplicadoLineas;
    return { aplicadoFacturas, retenciones, aplicadoLineas, neto, neto_base: neto * (form.tasa_cambio || 1) };
  }, [form]);

  function openNew(proveedorId?: number, facturaId?: number) {
    setEditing(null);
    setPreselected(facturaId ?? null);
    setShowAllFacturas(false);
    const f = blank(monedas[0] ?? base);
    if (proveedorId) f.contacto_id = proveedorId;
    setForm(f);
    setOpen(true);
  }

  // Atajo N
  useEffect(() => {
    const handler = () => openNew();
    window.addEventListener("app:new", handler);
    return () => window.removeEventListener("app:new", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monedas, base]);

  useEffect(() => {
    if (autoOpenedRef.current || !pais || searchParams.get("nuevo") !== "1") return;
    const p = searchParams.get("proveedor");
    const fId = searchParams.get("factura");
    const fecha = searchParams.get("fecha");
    const cuenta = searchParams.get("cuenta");
    const monto = searchParams.get("monto");
    const conciliar = searchParams.get("conciliar");
    const volverC = searchParams.get("volver_cuenta");
    const volverM = searchParams.get("volver_mes");
    autoOpenedRef.current = true;
    openNew(p ? Number(p) : undefined, fId ? Number(fId) : undefined);
    // Aplicar defaults pasados desde Conciliación
    if (fecha || cuenta || monto) {
      setForm(f => ({
        ...f,
        ...(fecha ? { fecha } : {}),
        ...(cuenta ? { cuenta_id: cuenta } : {}),
        ...(monto ? { lineas_directas: [{ key: nextRKey(), concepto_id: "", monto: Number(monto) }] } : {}),
      }));
    }
    if (conciliar) setConciliarId(Number(conciliar));
    if (volverC) setVolverCuenta(volverC);
    if (volverM) setVolverMes(volverM);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("nuevo"); params.delete("proveedor"); params.delete("factura");
    params.delete("fecha"); params.delete("cuenta"); params.delete("monto"); params.delete("conciliar");
    params.delete("volver_cuenta"); params.delete("volver_mes");
    const qs = params.toString();
    router.replace(qs ? `/egresos/pagos?${qs}` : "/egresos/pagos");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pais, searchParams]);

  useEffect(() => {
    if (autoEditedRef.current || !pais || !pagos || !searchParams.get("editar")) return;
    const editId = Number(searchParams.get("editar"));
    const pago = pagos.find(p => p.id === editId);
    if (!pago) return;
    autoEditedRef.current = true;
    openEdit(pago);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("editar");
    const qs = params.toString();
    router.replace(qs ? `/egresos/pagos?${qs}` : "/egresos/pagos");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pais, pagos, searchParams]);

  function openEdit(g: Gasto) {
    setEditing(g);
    setPreselected(null);
    setShowAllFacturas(false);
    setForm(pagoToForm(g, facturas ?? [], conceptos));
    setOpen(true);
  }

  // Cierra el modal y, si vinimos desde /conciliacion (volverCuenta/Mes
  // seteados), navega de vuelta preservando cuenta+mes. Si fue una edicion
  // normal, solo cierra el modal.
  function closeModalAndMaybeReturn() {
    setOpen(false);
    if (volverCuenta || volverMes) {
      const qs: string[] = [];
      if (volverCuenta) qs.push(`cuenta=${encodeURIComponent(volverCuenta)}`);
      if (volverMes) qs.push(`mes=${encodeURIComponent(volverMes)}`);
      setVolverCuenta(null); setVolverMes(null); setConciliarId(null);
      router.push(qs.length > 0 ? `/conciliacion?${qs.join("&")}` : "/conciliacion");
    }
  }

  const displayedFacturas = useMemo(() => {
    if (!preselectedFacturaId || showAllFacturas) return form.facturas_pagadas;
    return form.facturas_pagadas.filter(fp => fp.factura_id === preselectedFacturaId);
  }, [form.facturas_pagadas, preselectedFacturaId, showAllFacturas]);

  // ── Item helpers ──
  function setFP(id: number, patch: Partial<FPLocal>) {
    setForm(f => ({ ...f, facturas_pagadas: f.facturas_pagadas.map(fp => fp.factura_id === id ? { ...fp, ...patch } : fp) }));
  }
  function addRetencion(factura_id: number) {
    setForm(f => ({
      ...f,
      facturas_pagadas: f.facturas_pagadas.map(fp =>
        fp.factura_id === factura_id
          ? { ...fp, showRet: true, retenciones: [...fp.retenciones, { key: nextRKey(), tipo: TIPOS_RETENCION[0], monto: 0 }] }
          : fp
      ),
    }));
  }
  function removeRetencion(factura_id: number, rkey: string) {
    setForm(f => ({
      ...f,
      facturas_pagadas: f.facturas_pagadas.map(fp =>
        fp.factura_id === factura_id
          ? { ...fp, retenciones: fp.retenciones.filter(r => r.key !== rkey) }
          : fp
      ),
    }));
  }
  function addLinea() {
    setForm(f => ({ ...f, lineas_directas: [...f.lineas_directas, { key: nextRKey(), concepto_id: "", monto: 0 }] }));
  }
  function removeLinea(key: string) {
    setForm(f => ({ ...f, lineas_directas: f.lineas_directas.filter(l => l.key !== key) }));
  }
  function updateLinea(key: string, patch: Partial<DirectLine>) {
    setForm(f => ({ ...f, lineas_directas: f.lineas_directas.map(l => l.key === key ? { ...l, ...patch } : l) }));
  }

  function updateRetencion(factura_id: number, rkey: string, patch: Partial<RetLocal>) {
    setForm(f => ({
      ...f,
      facturas_pagadas: f.facturas_pagadas.map(fp =>
        fp.factura_id === factura_id
          ? { ...fp, retenciones: fp.retenciones.map(r => r.key === rkey ? { ...r, ...patch } : r) }
          : fp
      ),
    }));
  }

  async function handleSave() {
    if (!form.cuenta_id) { alert("La cuenta bancaria es obligatoria."); return; }
    if (totals.neto <= 0) { alert("El monto total del pago debe ser mayor a cero."); return; }

    // Validar que el monto asignado a cada factura no supere lo que falta pagar.
    // Las retenciones NO se suman: son parte del monto (van al gobierno en lugar de al banco).
    for (const fp of form.facturas_pagadas) {
      if (fp.monto <= 0) continue;
      const porPagar = Math.round((fp.total_factura - fp.monto_pagado_antes) * 100) / 100;
      if (fp.monto > porPagar + 0.01) {
        alert(
          `La factura ${fp.numero_factura ?? `#${fp.factura_id}`} tiene ${formatMoney(porPagar, fp.moneda, country.locale)} por pagar.\n\n` +
          `Estás asignando ${formatMoney(fp.monto, fp.moneda, country.locale)}.\n\n` +
          `Reducí el monto antes de continuar.`
        );
        return;
      }
      // Validar que las retenciones no superen el monto a pagar (sino el "neto" sería negativo)
      const totalRet = fp.retenciones.reduce((s, r) => s + Number(r.monto || 0), 0);
      if (totalRet > fp.monto + 0.01) {
        alert(
          `Las retenciones de la factura ${fp.numero_factura ?? `#${fp.factura_id}`} (${formatMoney(totalRet, fp.moneda, country.locale)}) ` +
          `no pueden ser mayores al monto a pagar (${formatMoney(fp.monto, fp.moneda, country.locale)}).`
        );
        return;
      }
    }

    setSaving(true);
    try {
      const { neto } = totals;
      const fpData = form.facturas_pagadas.filter(fp => fp.monto > 0);

      const facturaPagosPayload: FacturaPago[] = fpData.map(fp => ({
        factura_id: fp.factura_id,
        numero_factura: fp.numero_factura,
        total_factura: fp.total_factura,
        monto_pagado_antes: fp.monto_pagado_antes,
        monto: fp.monto,
        retenciones: fp.retenciones.map(r => ({ tipo: r.tipo, monto: r.monto }) as Retencion),
      }));

      const lineasActivas = form.lineas_directas.filter(l => l.monto > 0);
      const lineaNombres = lineasActivas.map(l => conceptos.find(c => c.id === l.concepto_id)?.nombre ?? "Varios");
      const primerConceptoId = lineasActivas[0] ? (lineasActivas[0].concepto_id || null) : null;
      const concepto = fpData.length > 0 && lineasActivas.length === 0
        ? fpData.map(fp => fp.numero_factura ?? `#${fp.factura_id}`).join(", ")
        : lineaNombres.length > 0 ? lineaNombres.join(", ") : "Pago";

      const itemsData: FacturaItem[] = lineasActivas.map(l => ({
        concepto_id: l.concepto_id || null,
        concepto_nombre: conceptos.find(c => c.id === l.concepto_id)?.nombre ?? "",
        precio: l.monto,
        descuento: 0,
        impuesto: 0,
        cantidad: 1,
        observaciones: "",
        neto: l.monto,
        iva_monto: 0,
        total: l.monto,
      }));

      const payload = {
        ctx_pais: pais,
        fecha: form.fecha,
        tipo: "gasto" as const,
        contacto_id: form.contacto_id === "" ? null : Number(form.contacto_id),
        cuenta_id: form.cuenta_id || null,
        concepto,
        categoria: lineaNombres[0] ?? concepto,
        concepto_id: primerConceptoId,
        items: itemsData.length > 0 ? itemsData : null,
        subtotal: neto,
        iva: 0,
        iva_monto: 0,
        total: neto,
        moneda: form.moneda,
        tasa_cambio: form.tasa_cambio,
        estado: "pagado" as GastoEstado,
        metodo_pago: form.metodo_pago || null,
        monto_pagado: neto,
        notas: form.nota || null,
        factura_pagos: facturaPagosPayload.length > 0 ? facturaPagosPayload : null,
      };

      let pagoId: number;
      const proveedorNombre = contactos?.find(c => c.id === payload.contacto_id)?.nombre ?? "";

      if (editing) {
        await updateRow("gastos", editing.id, payload);
        pagoId = editing.id;
        // Sync edición pago sin factura
        const tieneLineasDirectas = (payload.items ?? []).length > 0;
        if (tieneLineasDirectas) {
          const distConfigs: Record<string, unknown> = {};
          if (payload.contacto_id) {
            for (const l of lineasActivas) {
              const nombre = conceptos.find(c => c.id === l.concepto_id)?.nombre;
              if (nombre) distConfigs[nombre] = effectiveConfig(pagoId, payload.contacto_id, nombre);
            }
          }
          fetch("/api/sync-factura", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, id: pagoId, proveedor: proveedorNombre, tipo_sync: "pago", dist_configs: distConfigs }),
          }).then(r => r.json()).then(d => { if (!d.ok) console.error("[sync-pago] PATCH error:", d.error); })
            .catch(e => console.error("[sync-pago] PATCH network error:", e));
        }
      } else {
        const inserted = await insertRow("gastos", payload);
        pagoId = inserted.id;
        // Sync nuevo pago sin factura
        const tieneLineasDirectas = (payload.items ?? []).length > 0;
        if (tieneLineasDirectas) {
          const distConfigs: Record<string, unknown> = {};
          if (payload.contacto_id) {
            for (const l of lineasActivas) {
              const nombre = conceptos.find(c => c.id === l.concepto_id)?.nombre;
              if (nombre) distConfigs[nombre] = loadConfig(payload.contacto_id, nombre);
            }
          }
          fetch("/api/sync-factura", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, id: pagoId, proveedor: proveedorNombre, tipo_sync: "pago", dist_configs: distConfigs }),
          }).then(r => r.json()).then(d => { if (!d.ok) console.error("[sync-pago] POST error:", d.error); else console.log("[sync-pago] OK"); })
            .catch(e => console.error("[sync-pago] POST network error:", e));
        }
      }

      // Update each linked factura
      for (const fp of fpData) {
        const factura = (facturas ?? []).find(f => f.id === fp.factura_id);
        if (!factura) continue;
        const nuevo_pagado = Math.round((Number(factura.monto_pagado) + fp.monto) * 100) / 100;
        const total_factura = Math.round(Number(factura.total) * 100) / 100;
        const nuevo_estado: GastoEstado = nuevo_pagado >= total_factura ? "pagado" : "parcial";
        await updateRow("gastos", fp.factura_id, {
          monto_pagado: Math.min(nuevo_pagado, total_factura),
          estado: nuevo_estado,
        });
      }

      saveLastTasa(form.moneda, form.tasa_cambio);

      // Snapshot distribution config at payment time (immutable historical record)
      if (payload.contacto_id) {
        const conceptNames = lineasActivas
          .map(l => conceptos.find(c => c.id === l.concepto_id)?.nombre)
          .filter(Boolean) as string[];
        if (conceptNames.length > 0) {
          snapshotPayment(pagoId, payload.contacto_id, conceptNames);
        }
      }

      // Si vino desde Conciliación, vinculá el pago al movimiento del banco
      const cameFromConciliacion = conciliarId != null;
      if (conciliarId) {
        try {
          const sb = createClient();
          await sb.from("conciliacion_movimientos").update({
            matched_type: "pago",
            matched_id: pagoId,
            matched_by: "created",
            matched_score: 100,
            estado: "conciliado",
            reconciled_at: new Date().toISOString(),
          } as never).eq("id", conciliarId);
        } catch (e) {
          console.warn("[conciliacion] no se pudo vincular:", e);
        }
        setConciliarId(null);
      }

      await reload();
      setOpen(false);
      if (cameFromConciliacion) {
        const qs: string[] = [];
        if (volverCuenta) qs.push(`cuenta=${encodeURIComponent(volverCuenta)}`);
        if (volverMes) qs.push(`mes=${encodeURIComponent(volverMes)}`);
        setVolverCuenta(null); setVolverMes(null);
        router.push(qs.length > 0 ? `/conciliacion?${qs.join("&")}` : "/conciliacion");
      }
    } catch (err) {
      alert("Error: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(g: Gasto) {
    if (!confirm("¿Eliminar este pago?")) return;
    try {
      const supabase = createClient();
      const fps = g.factura_pagos ?? [];
      for (const fp of fps) {
        const { data: factura } = await supabase.from("gastos").select("*").eq("id", fp.factura_id).single();
        if (!factura) continue;
        const nuevo_pagado = Math.max(0, Math.round((Number(factura.monto_pagado) - Number(fp.monto)) * 100) / 100);
        const total_factura = Math.round(Number(factura.total) * 100) / 100;
        const nuevo_estado: GastoEstado =
          nuevo_pagado <= 0 ? "pendiente" : nuevo_pagado >= total_factura ? "pagado" : "parcial";
        await updateRow("gastos", fp.factura_id, { monto_pagado: nuevo_pagado, estado: nuevo_estado });
      }
      await cascadeAnticiposBeforeDeleteGasto(g.id);
      await deleteRow("gastos", g.id);
      await reload();
      // Sync eliminación (si tenía líneas directas)
      fetch("/api/sync-factura", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: g.id, tipo_sync: "pago" }),
      }).catch(e => console.error("[sync-pago] DELETE network error:", e));
    } catch (err) { alert("Error: " + (err as Error).message); }
  }

  return (
    <>
      <PageHeader
        title="Pagos"
        description="Pagos a proveedores y gastos directos"
        action={<button className="btn btn-primary" onClick={() => openNew()}><Plus className="w-4 h-4" /> Nuevo pago</button>}
      />

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input className="input pl-9 w-52" placeholder="Detalle…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex items-center gap-1.5">
              <input type="date" className="input w-36 text-sm" placeholder="Desde" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} title="Fecha desde" />
              <span className="text-[var(--muted)] text-sm">—</span>
              <input type="date" className="input w-36 text-sm" placeholder="Hasta" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} title="Fecha hasta" />
            </div>
            <select className="select w-44 text-sm" value={filtroProveedor} onChange={e => setFiltroProveedor(e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">Todos los proveedores</option>
              {proveedores.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <select className="select w-44 text-sm" value={filtroCuenta} onChange={e => setFiltroCuenta(e.target.value)}>
              <option value="">Todas las cuentas</option>
              {(cuentas ?? []).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            {hayFiltros && (
              <button className="btn btn-ghost text-sm text-[var(--muted)] flex items-center gap-1" onClick={limpiarFiltros}>
                <X className="w-3.5 h-3.5" /> Limpiar
              </button>
            )}
          </div>
          {hayFiltros && (
            <p className="text-xs text-[var(--muted)]">{filtered.length} resultado{filtered.length !== 1 ? "s" : ""}</p>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--muted)]" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<CreditCard className="w-6 h-6" />}
            title={pagos?.length ? "Sin resultados" : "Aún no hay pagos"}
            description="Registrá pagos a proveedores o gastos directos."
            action={!pagos?.length && <button className="btn btn-primary" onClick={() => openNew()}><Plus className="w-4 h-4" /> Nuevo pago</button>}
          />
        ) : (
          <>
          <table className="table text-sm">
            <thead>
              <tr>
                <SortHeader label="#" sortKey="id" align="center" className="text-center w-10" active={sortBy === "id"} dir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Fecha" sortKey="fecha" active={sortBy === "fecha"} dir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Detalle" sortKey="detalle" active={sortBy === "detalle"} dir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Proveedor" sortKey="proveedor" active={sortBy === "proveedor"} dir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Cuenta" sortKey="cuenta" active={sortBy === "cuenta"} dir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Método" sortKey="metodo" active={sortBy === "metodo"} dir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Monto" sortKey="monto" align="right" className="text-right" active={sortBy === "monto"} dir={sortDir} onToggle={toggleSort} />
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(g => {
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
                      {fps.length > 0
                        ? <span>{fps.map(fp => fp.numero_factura ?? `#${fp.factura_id}`).join(", ")}</span>
                        : <span className="text-[var(--muted)]">{g.concepto}</span>
                      }
                    </td>
                    <td className="text-[var(--muted)]">
                      {g.contacto_id
                        ? <Link href={`/contactos/${g.contacto_id}`} className="hover:underline hover:text-[var(--primary)]">{contactos?.find(c => c.id === g.contacto_id)?.nombre ?? `#${g.contacto_id}`}</Link>
                        : "—"}
                    </td>
                    <td className="text-[var(--muted)]">{(cuentas ?? []).find(c => c.id === g.cuenta_id)?.nombre ?? "—"}</td>
                    <td className="text-[var(--muted)]">{g.metodo_pago ?? "—"}</td>
                    <td className="text-right font-semibold text-red-600 whitespace-nowrap">
                      {formatMoney(Number(g.total), g.moneda, country.locale)}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn btn-ghost p-1.5" onClick={() => openEdit(g)}><Pencil className="w-4 h-4" /></button>
                      <button className="btn btn-ghost p-1.5 text-red-600" onClick={() => remove(g)}><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            pageSizes={pagination.pageSizes}
            total={pagination.total}
            from={pagination.from}
            to={pagination.to}
            onPage={pagination.setPage}
            onPageSize={pagination.setPageSize}
          />
          </>
        )}
      </div>

      {/* ── Modal ── */}
      <Modal open={open} onClose={closeModalAndMaybeReturn} title={editing ? "Editar pago" : "Nuevo pago"} size="xl">
        <div className="space-y-5">
          {editing && (
            <EntityMeta entity="gastos" entityId={editing.id} variant="block" />
          )}

          {/* General info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Contacto / Proveedor</label>
              <SearchableSelect
                value={form.contacto_id}
                onChange={v => {
                  setPreselected(null);
                  setShowAllFacturas(false);
                  setForm(f => ({ ...f, contacto_id: v === "" ? "" : Number(v), facturas_pagadas: [] }));
                }}
                options={proveedores.map(c => ({ value: c.id, label: c.nombre }))}
                placeholder="— Sin contacto —"
                emptyLabel="— Sin contacto —"
              />
            </div>
            <div>
              <label className="label">Cuenta bancaria *</label>
              <select className="select" value={form.cuenta_id} onChange={e => setForm(f => ({ ...f, cuenta_id: e.target.value }))}>
                <option value="">— Seleccionar cuenta —</option>
                {(cuentas ?? []).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Fecha *</label>
              <input type="date" className="input" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} required />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Forma de pago</label>
              <select className="select" value={form.metodo_pago} onChange={e => setForm(f => ({ ...f, metodo_pago: e.target.value }))}>
                {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Moneda *</label>
              <select className="select" value={form.moneda}
                onChange={e => setForm(f => ({ ...f, moneda: e.target.value as CurrencyCode, tasa_cambio: getLastTasa(e.target.value) }))}>
                {monedas.map(code => <option key={code} value={code}>{code} — {CURRENCIES[code].name}</option>)}
              </select>
            </div>
            {isForeign && (
              <div>
                <label className="label">Tasa de cambio</label>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-[var(--muted)]">1 {form.moneda} =</span>
                  <input type="text" inputMode="decimal" className="input flex-1"
                    value={form.tasa_cambio || ""} onChange={e => setForm(f => ({ ...f, tasa_cambio: parseMonto(e.target.value) }))} />
                  <span className="text-sm text-[var(--muted)]">{base}</span>
                  <TasaCambioButton
                    moneda={form.moneda}
                    fecha={form.fecha}
                    onChange={(v) => setForm(f => ({ ...f, tasa_cambio: v }))}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="label">Nota de egreso</label>
            <textarea className="textarea" rows={2} value={form.nota} onChange={e => setForm(f => ({ ...f, nota: e.target.value }))} />
          </div>

          {/* Facturas pendientes */}
          {form.contacto_id !== "" && (
            <div className="border border-[var(--border)] rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Facturas pendientes</p>
                  <p className="text-xs text-[var(--muted)]">Ingresá el monto a aplicar a cada factura</p>
                </div>
                {preselectedFacturaId !== null && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showAllFacturas}
                      onChange={e => setShowAllFacturas(e.target.checked)}
                      className="rounded"
                    />
                    Ver todas las pendientes
                  </label>
                )}
              </div>

              {form.facturas_pagadas.length === 0 ? (
                <p className="px-4 py-6 text-sm text-center text-[var(--muted)]">No hay facturas pendientes para este proveedor</p>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {displayedFacturas.map(fp => {
                    const porPagar = fp.total_factura - fp.monto_pagado_antes;
                    const totalRet = fp.retenciones.reduce((s, r) => s + r.monto, 0);
                    return (
                      <div key={fp.factura_id} className="px-4 py-3 space-y-2">
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
                          <div>
                            <p className="text-xs text-[var(--muted)]">N° Factura</p>
                            <p className="text-sm font-medium">{fp.numero_factura || `#${fp.factura_id}`}</p>
                          </div>
                          <div>
                            <p className="text-xs text-[var(--muted)]">Total</p>
                            <p className="text-sm">{formatMoney(fp.total_factura, fp.moneda, country.locale)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-[var(--muted)]">Pagado</p>
                            <p className="text-sm">{formatMoney(fp.monto_pagado_antes, fp.moneda, country.locale)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-[var(--muted)]">Por pagar</p>
                            <p className="text-sm font-medium text-amber-600">{formatMoney(porPagar, fp.moneda, country.locale)}</p>
                          </div>
                          <div>
                            <label className="text-xs text-[var(--muted)]">Monto a pagar *</label>
                            <div onClick={() => { if (!fp.monto) setFP(fp.factura_id, { monto: porPagar }); }}>
                              <MoneyInput
                                className={`input text-sm py-1 ${fp.monto > porPagar + 0.01 ? "border-red-500 bg-red-50" : ""}`}
                                placeholder="0,00"
                                value={fp.monto}
                                onChange={(n) => setFP(fp.factura_id, { monto: n })}
                              />
                            </div>
                            {fp.monto > porPagar + 0.01 && (
                              <p className="text-[11px] text-red-600 mt-1">
                                Excede {formatMoney(porPagar, fp.moneda, country.locale)} por pagar
                              </p>
                            )}
                            {totalRet > fp.monto + 0.01 && fp.monto > 0 && (
                              <p className="text-[11px] text-amber-600 mt-1">
                                Retenciones mayores al monto
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Retenciones */}
                        <div className="ml-1">
                          {fp.retenciones.map(r => (
                            <div key={r.key} className="flex items-center gap-2 mt-1.5">
                              <select className="select text-xs py-1 w-36"
                                value={r.tipo} onChange={e => updateRetencion(fp.factura_id, r.key, { tipo: e.target.value })}>
                                {TIPOS_RETENCION.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                              <MoneyInput
                                className="input text-xs py-1 w-36"
                                placeholder="Monto"
                                value={r.monto}
                                onChange={(n) => updateRetencion(fp.factura_id, r.key, { monto: n })}
                              />
                              <button type="button" className="text-[var(--muted)] hover:text-red-500"
                                onClick={() => removeRetencion(fp.factura_id, r.key)}>
                                <X className="w-3.5 h-3.5" />
                              </button>
                              <span className="text-xs text-[var(--muted)]">retención</span>
                            </div>
                          ))}
                          <button type="button"
                            className="text-xs text-[var(--primary)] hover:underline mt-1.5 flex items-center gap-1"
                            onClick={() => addRetencion(fp.factura_id)}>
                            <Plus className="w-3 h-3" /> Agregar retención
                          </button>
                          {totalRet > 0 && (
                            <p className="text-xs text-slate-500 mt-1">
                              Total retenciones: {formatMoney(totalRet, form.moneda, country.locale)} →
                              Transferir: {formatMoney(fp.monto - totalRet, form.moneda, country.locale)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Líneas directas */}
          <div className="border border-[var(--border)] rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-4 py-2.5 border-b border-[var(--border)]">
              <p className="font-medium text-sm">Valores directos</p>
              <p className="text-xs text-[var(--muted)]">Montos no asociados a facturas pendientes</p>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {form.lineas_directas.map(l => (
                <div key={l.key} className="flex items-center gap-3 px-4 py-2.5">
                  <SearchableSelect
                    size="sm"
                    className="w-64"
                    value={l.concepto_id}
                    onChange={v => updateLinea(l.key, { concepto_id: v })}
                    options={conceptos.map(c => ({ value: c.id, label: c.nombre }))}
                    placeholder="— Concepto —"
                    emptyLabel="— Sin concepto —"
                  />
                  <MoneyInput
                    className="input w-36 text-sm py-1"
                    placeholder="0,00"
                    value={l.monto}
                    onChange={(n) => updateLinea(l.key, { monto: n })}
                  />
                  <button
                    type="button"
                    className="text-[var(--muted)] hover:text-red-500 disabled:opacity-30"
                    onClick={() => removeLinea(l.key)}
                    disabled={form.lineas_directas.length === 1}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="px-4 py-2 border-t border-[var(--border)] bg-slate-50/50">
              <button type="button" className="text-sm text-[var(--primary)] hover:underline flex items-center gap-1 font-medium" onClick={addLinea}>
                <Plus className="w-3.5 h-3.5" /> Agregar línea
              </button>
            </div>
          </div>

          {/* Totals */}
          {totals.neto > 0 && (
            <div className="flex justify-end">
              <div className="space-y-1 text-sm w-80">
                {isForeign && (
                  <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2 flex-wrap gap-1">
                    <span className="text-amber-800 text-sm">1 {form.moneda} =</span>
                    <input
                      type="text" inputMode="decimal"
                      className="input w-32 text-sm py-1 mx-2"
                      placeholder="Tasa de cambio"
                      value={form.tasa_cambio || ""}
                      onChange={e => setForm(f => ({ ...f, tasa_cambio: parseMonto(e.target.value) }))}
                    />
                    <span className="text-amber-800 text-sm">{base}</span>
                    <TasaCambioButton
                      moneda={form.moneda}
                      fecha={form.fecha}
                      onChange={(v) => setForm(f => ({ ...f, tasa_cambio: v }))}
                    />
                  </div>
                )}
                {totals.aplicadoFacturas > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-[var(--muted)]">Subtotal facturas</span>
                      <span>{formatMoney(totals.aplicadoFacturas, form.moneda, country.locale)}</span>
                    </div>
                    {totals.retenciones > 0 && (
                      <div className="flex justify-between">
                        <span className="text-[var(--muted)]">Retenciones</span>
                        <span className="text-amber-600">-{formatMoney(totals.retenciones, form.moneda, country.locale)}</span>
                      </div>
                    )}
                  </>
                )}
                {form.lineas_directas.filter(l => l.monto > 0).map(l => (
                  <div key={l.key} className="flex justify-between">
                    <span className="text-[var(--muted)]">{conceptos.find(c => c.id === l.concepto_id)?.nombre ?? "Varios"}</span>
                    <span>{formatMoney(l.monto, form.moneda, country.locale)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-1 border-t border-[var(--border)]">
                  <span className="font-semibold">Total {form.moneda}</span>
                  <span className="font-bold text-base text-red-600">{formatMoney(totals.neto, form.moneda, country.locale)}</span>
                </div>
                {isForeign && form.tasa_cambio > 0 && (
                  <div className="flex justify-between text-amber-700 bg-amber-50 -mx-2 px-2 py-1 rounded">
                    <span className="font-semibold">Total {base}</span>
                    <span className="font-bold">{formatMoney(totals.neto_base, base, country.locale)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
            <button type="button" className="btn btn-secondary" onClick={closeModalAndMaybeReturn}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
