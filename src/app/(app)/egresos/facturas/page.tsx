"use client";
import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTable, insertRow, updateRow, deleteRow, paisFilter, cascadeAnticiposBeforeDeleteGasto } from "@/lib/useSupabaseData";
import { createClient } from "@/lib/supabase/client";
import type { Gasto, GastoEstado, FacturaItem } from "@/lib/types";
import { useConfig } from "@/lib/useConfig";
import { CURRENCIES, CurrencyCode, monedasDisponibles } from "@/lib/countries";
import { formatMoney, formatDate, todayISO } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import EmptyState from "@/components/EmptyState";
import Link from "next/link";
import { Plus, Receipt, Pencil, Trash2, Search, CreditCard, X, Loader2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import SearchableSelect from "@/components/SearchableSelect";
import { snapshotPayment, loadConfig, effectiveConfig } from "@/lib/proveedoresConfig";
import TasaCambioButton from "@/components/TasaCambioButton";
import { useSortable } from "@/lib/useSortable";
import SortHeader from "@/components/SortHeader";
import { usePagination } from "@/lib/usePagination";
import Pagination from "@/components/Pagination";
import EntityMeta from "@/components/EntityMeta";

// ── Types ──────────────────────────────────────────────────────────────────
type LineItem = {
  key: string;
  concepto_id: string;
  precio: number;
  impuesto: number;
  cantidad: number;
  observaciones: string;
};

type FormState = {
  fecha: string;
  fecha_vencimiento: string;
  contacto_id: number | "";
  numero_factura: string;
  moneda: CurrencyCode;
  tasa_cambio: number;
  notas: string;
  items: LineItem[];
};

let _keyCounter = 0;
const nextKey = () => String(++_keyCounter);

function blankItem(): LineItem {
  return { key: nextKey(), concepto_id: "", precio: 0, impuesto: 0, cantidad: 1, observaciones: "" };
}

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
  return { fecha: todayISO(), fecha_vencimiento: todayISO(), contacto_id: "", numero_factura: "", moneda, tasa_cambio: getLastTasa(moneda), notas: "", items: [blankItem()] };
}

function gastoToForm(g: Gasto): FormState {
  const raw = (g as unknown as { items?: FacturaItem[] }).items;
  const items: LineItem[] = raw?.length
    ? raw.map((it, i) => ({
        key: String(i),
        concepto_id: it.concepto_id ?? "",
        precio: Number(it.precio),
        impuesto: Number(it.impuesto),
        cantidad: Number(it.cantidad),
        observaciones: it.observaciones ?? "",
      }))
    : [{ key: "0", concepto_id: g.concepto_id ?? "", precio: Number(g.subtotal), impuesto: Number(g.iva), cantidad: 1, observaciones: "" }];
  return {
    fecha: g.fecha,
    fecha_vencimiento: g.fecha_vencimiento ?? "",
    contacto_id: g.contacto_id ?? "",
    numero_factura: g.numero_factura ?? "",
    moneda: g.moneda,
    tasa_cambio: (g as unknown as { tasa_cambio?: number }).tasa_cambio ?? 1,
    notas: g.notas ?? "",
    items,
  };
}

function itemNeto(it: LineItem) { return it.precio * it.cantidad; }
function itemIva(it: LineItem) { return itemNeto(it) * (it.impuesto / 100); }
function itemTotal(it: LineItem) { return itemNeto(it) + itemIva(it); }

// ── Component ──────────────────────────────────────────────────────────────
export default function FacturasPage() {
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
  const [filterEstado, setFilterEstado] = useState<"todos" | GastoEstado>("todos");
  const [saving, setSaving] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const autoOpenedRef = useRef(false);

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const { data: gastos, reload, loading } = useTable("gastos", {
    orderBy: "fecha",
    filter: [...(paisFilter(pais) ?? []), { column: "tipo", op: "eq", value: "factura_proveedor" }],
    skip: !pais, deps: [pais],
  });
  const { data: pagosData } = useTable("gastos", {
    orderBy: "fecha",
    filter: [...(paisFilter(pais) ?? []), { column: "tipo", op: "eq", value: "gasto" }],
    skip: !pais, deps: [pais],
  });
  const { data: notasData } = useTable("notas_credito", {
    orderBy: "fecha", filter: paisFilter(pais), skip: !pais, deps: [pais],
  });
  const { data: contactos } = useTable("contactos", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });
  const { data: conceptosAll } = useTable("conceptos", {
    orderBy: "nombre", ascending: true, filter: paisFilter(pais), skip: !pais, deps: [pais],
  });

  const conceptos = (conceptosAll ?? []).filter(c => c.tipo === "egreso" || c.tipo === "ambos");
  const proveedores = (contactos ?? []).filter(c => c.tipo === "proveedor" || c.tipo === "ambos");

  const filteredRaw = (gastos ?? []).filter(g => {
    if (filterEstado !== "todos" && g.estado !== filterEstado) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return g.concepto.toLowerCase().includes(q) || (g.numero_factura?.toLowerCase() ?? "").includes(q);
  });

  const { sortBy, sortDir, toggleSort, sorted } = useSortable(filteredRaw, {
    getValue: (g, key) => {
      switch (key) {
        case "numero_factura": return g.numero_factura ?? "";
        case "proveedor": return contactos?.find(c => c.id === g.contacto_id)?.nombre ?? "";
        case "fecha": return g.fecha;
        case "fecha_vencimiento": return g.fecha_vencimiento ?? "";
        case "estado": return g.estado;
        case "total": return Number(g.total);
        case "pagado": return efectivoPagadoByFactura[g.id] ?? 0;
        case "por_pagar": return Number(g.total) - Number(g.monto_pagado);
        default: return "";
      }
    },
    initial: { key: "fecha", dir: "desc" },
  });
  const filtered = sorted ?? filteredRaw;

  const pagination = usePagination(filtered, "facturas", 50);
  const pageRows = pagination.pageRows;

  const totals = useMemo(() => {
    const subtotal = form.items.reduce((s, it) => s + itemNeto(it), 0);
    const iva_monto = form.items.reduce((s, it) => s + itemIva(it), 0);
    const total = subtotal + iva_monto;
    const total_base = total * (form.tasa_cambio || 1);
    return { subtotal, iva_monto, total, total_base };
  }, [form.items, form.tasa_cambio]);

  // Monto bruto aplicado a la factura (incluye retenciones). Para "Por pagar".
  const cashPaidByFactura = useMemo(() => {
    const map: Record<number, number> = {};
    for (const pago of (pagosData ?? [])) {
      for (const fp of (pago.factura_pagos ?? [])) {
        map[fp.factura_id] = Math.round(((map[fp.factura_id] ?? 0) + Number(fp.monto)) * 100) / 100;
      }
    }
    return map;
  }, [pagosData]);

  // Monto efectivamente pagado del banco (monto - retenciones). Para columna "Pagado".
  const efectivoPagadoByFactura = useMemo(() => {
    const map: Record<number, number> = {};
    for (const pago of (pagosData ?? [])) {
      for (const fp of (pago.factura_pagos ?? [])) {
        const ret = (fp.retenciones ?? []).reduce((s, r) => s + Number(r.monto || 0), 0);
        const neto = Number(fp.monto) - ret;
        map[fp.factura_id] = Math.round(((map[fp.factura_id] ?? 0) + neto) * 100) / 100;
      }
    }
    return map;
  }, [pagosData]);

  const creditByFactura = useMemo(() => {
    const map: Record<number, number> = {};
    for (const nota of (notasData ?? []).filter(n => n.tipo === "recibida")) {
      if (nota.gasto_relacionado_id) {
        map[nota.gasto_relacionado_id] = Math.round(((map[nota.gasto_relacionado_id] ?? 0) + Number(nota.monto)) * 100) / 100;
      }
    }
    return map;
  }, [notasData]);

  // Anticipos aplicados por factura
  const [anticipoApls, setAnticipoApls] = useState<{ factura_id: number; monto: number }[]>([]);
  useEffect(() => {
    if (!pais) return;
    const sb = createClient();
    sb.from("anticipos_aplicaciones").select("factura_id,monto").eq("ctx_pais", pais).then(({ data }) => {
      setAnticipoApls((data ?? []) as { factura_id: number; monto: number }[]);
    });
  }, [pais, gastos]);
  const anticipoByFactura = useMemo(() => {
    const m: Record<number, number> = {};
    for (const a of anticipoApls) {
      m[a.factura_id] = Math.round(((m[a.factura_id] ?? 0) + Number(a.monto)) * 100) / 100;
    }
    return m;
  }, [anticipoApls]);

  const totalPorMoneda = (gastos ?? []).reduce<Record<string, { total: number; pendiente: number }>>((acc, g) => {
    if (!acc[g.moneda]) acc[g.moneda] = { total: 0, pendiente: 0 };
    acc[g.moneda].total += Number(g.total);
    if (g.estado !== "pagado") acc[g.moneda].pendiente += Number(g.total) - Number(g.monto_pagado);
    return acc;
  }, {});

  const isForeignCurrency = form.moneda !== base;

  function openNew(proveedorId?: number) {
    setEditing(null);
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
    const proveedorParam = searchParams.get("proveedor");
    autoOpenedRef.current = true;
    openNew(proveedorParam ? Number(proveedorParam) : undefined);
    const p = new URLSearchParams(searchParams.toString());
    p.delete("nuevo"); p.delete("proveedor");
    const qs = p.toString();
    router.replace(qs ? `/egresos/facturas?${qs}` : "/egresos/facturas");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pais, searchParams]);

  function openEdit(g: Gasto) {
    if (Number(g.monto_pagado) > 0) { alert("No se puede editar una factura con pagos o notas de crédito registrados."); return; }
    setEditing(g); setForm(gastoToForm(g)); setOpen(true);
  }
  function addItem() { setForm(f => ({ ...f, items: [...f.items, blankItem()] })); }
  function removeItem(key: string) { setForm(f => ({ ...f, items: f.items.filter(i => i.key !== key) })); }
  function updateItem(key: string, patch: Partial<Omit<LineItem, "key">>) {
    setForm(f => ({ ...f, items: f.items.map(i => i.key === key ? { ...i, ...patch } : i) }));
  }

  async function handleSave(mode: "save" | "new" | "pay") {
    if (!form.numero_factura.trim()) { alert("El número de factura es obligatorio."); return; }
    if (form.contacto_id === "") { alert("El proveedor es obligatorio."); return; }
    if (!form.fecha_vencimiento) { alert("La fecha de vencimiento es obligatoria."); return; }
    if (form.fecha_vencimiento < form.fecha) { alert("La fecha de vencimiento no puede ser anterior a la fecha de creación."); return; }
    if (form.items.some(it => !it.concepto_id || it.precio <= 0)) {
      alert("Todos los ítems deben tener concepto y precio.");
      return;
    }
    const duplicada = (gastos ?? []).find(g =>
      g.tipo === "factura_proveedor" &&
      g.contacto_id === Number(form.contacto_id) &&
      g.numero_factura === form.numero_factura &&
      g.id !== editing?.id
    );
    if (duplicada) {
      alert(`Ya existe una factura N° ${form.numero_factura} para este proveedor.`);
      return;
    }
    setSaving(true);
    try {
      const { subtotal, iva_monto, total } = totals;
      const firstItem = form.items[0];
      const firstConcept = conceptos.find(c => c.id === firstItem?.concepto_id);
      const concepto = firstConcept?.nombre || "Factura de proveedor";

      const itemsData: FacturaItem[] = form.items.map(it => ({
        concepto_id: it.concepto_id || null,
        concepto_nombre: conceptos.find(c => c.id === it.concepto_id)?.nombre ?? "",
        precio: it.precio,
        descuento: 0,
        impuesto: it.impuesto,
        cantidad: it.cantidad,
        observaciones: it.observaciones,
        neto: itemNeto(it),
        iva_monto: itemIva(it),
        total: itemTotal(it),
      }));

      const payload = {
        ctx_pais: pais,
        fecha: form.fecha,
        fecha_vencimiento: form.fecha_vencimiento || null,
        tipo: "factura_proveedor" as const,
        contacto_id: !form.contacto_id ? null : Number(form.contacto_id),
        numero_factura: form.numero_factura || null,
        concepto,
        categoria: firstConcept?.nombre ?? "",
        concepto_id: firstItem?.concepto_id || null,
        cuenta_id: null,
        subtotal,
        iva: firstItem?.impuesto ?? 0,
        iva_monto,
        total,
        moneda: form.moneda,
        tasa_cambio: form.tasa_cambio,
        estado: "pendiente" as GastoEstado,
        metodo_pago: null,
        monto_pagado: 0,
        notas: form.notas || null,
        items: itemsData,
      };

      let facturaId: number;
      const proveedorNombre = contactos?.find(c => c.id === payload.contacto_id)?.nombre ?? "";
      if (editing) {
        await updateRow("gastos", editing.id, payload);
        facturaId = editing.id;
        // Sync edición
        const distConfigsEdit: Record<string, unknown> = {};
        if (payload.contacto_id) {
          for (const it of form.items) {
            const nombre = conceptos.find(c => c.id === it.concepto_id)?.nombre;
            if (nombre) distConfigsEdit[nombre] = effectiveConfig(facturaId, payload.contacto_id, nombre);
          }
        }
        fetch("/api/sync-factura", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, id: facturaId, proveedor: proveedorNombre, tipo_sync: "factura", dist_configs: distConfigsEdit }),
        })
          .then(r => r.json())
          .then(d => { if (!d.ok) console.error("[sync-factura] PATCH error:", d.error); })
          .catch(e => console.error("[sync-factura] PATCH network error:", e));
      } else {
        const inserted = await insertRow("gastos", payload);
        facturaId = inserted.id;
        // Sync nueva factura
        const distConfigsNew: Record<string, unknown> = {};
        if (payload.contacto_id) {
          for (const it of form.items) {
            const nombre = conceptos.find(c => c.id === it.concepto_id)?.nombre;
            if (nombre) distConfigsNew[nombre] = loadConfig(payload.contacto_id, nombre);
          }
        }
        fetch("/api/sync-factura", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, id: facturaId, proveedor: proveedorNombre, tipo_sync: "factura", dist_configs: distConfigsNew }),
        })
          .then(r => r.json())
          .then(d => { if (!d.ok) console.error("[sync-factura] POST error:", d.error); else console.log("[sync-factura] OK"); })
          .catch(e => console.error("[sync-factura] POST network error:", e));
      }
      saveLastTasa(form.moneda, form.tasa_cambio);

      // Snapshot distribution config at factura save time (immutable historical record)
      if (payload.contacto_id) {
        const conceptNames = form.items
          .map(it => conceptos.find(c => c.id === it.concepto_id)?.nombre)
          .filter(Boolean) as string[];
        if (conceptNames.length > 0) {
          snapshotPayment(facturaId, payload.contacto_id, conceptNames);
        }
      }

      await reload();

      if (mode === "new") {
        setEditing(null);
        setForm(blank(form.moneda));
      } else if (mode === "pay") {
        setOpen(false);
        const qs = form.contacto_id
          ? `?nuevo=1&proveedor=${form.contacto_id}&factura=${facturaId}`
          : `?nuevo=1&factura=${facturaId}`;
        router.push(`/egresos/pagos${qs}`);
      } else {
        setOpen(false);
      }
    } catch (err) {
      alert("Error: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(g: Gasto) {
    if (Number(g.monto_pagado) > 0) { alert("No se puede eliminar una factura con pagos o notas de crédito registrados."); return; }
    if (!confirm("¿Eliminar esta factura?")) return;
    try {
      await cascadeAnticiposBeforeDeleteGasto(g.id);
      await deleteRow("gastos", g.id);
      await reload();
      // Sync eliminación
      fetch("/api/sync-factura", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: g.id, tipo_sync: "factura" }),
      })
        .then(r => r.json())
        .then(d => { if (!d.ok) console.error("[sync-factura] DELETE error:", d.error); })
        .catch(e => console.error("[sync-factura] DELETE network error:", e));
    }
    catch (err) { alert("Error: " + (err as Error).message); }
  }

  /** Re-sincroniza una factura al Google Sheet (PATCH = borra fila vieja e inserta nueva) */
  async function resyncFactura(g: Gasto) {
    try {
      const proveedorNombre = contactos?.find(c => c.id === g.contacto_id)?.nombre ?? "";
      const distConfigs: Record<string, unknown> = {};
      if (g.contacto_id) {
        const itemsList = (g.items ?? []);
        if (itemsList.length > 0) {
          for (const it of itemsList) {
            const nombre = it.concepto_nombre || conceptos.find(c => c.id === it.concepto_id)?.nombre;
            if (nombre) distConfigs[nombre] = effectiveConfig(g.id, g.contacto_id, nombre);
          }
        } else if (g.concepto) {
          distConfigs[g.concepto] = effectiveConfig(g.id, g.contacto_id, g.concepto);
        }
      }
      const body = {
        id: g.id,
        ctx_pais: g.ctx_pais,
        fecha: g.fecha,
        fecha_vencimiento: g.fecha_vencimiento ?? null,
        tipo: g.tipo,
        contacto_id: g.contacto_id,
        numero_factura: g.numero_factura,
        concepto: g.concepto,
        categoria: g.categoria,
        concepto_id: g.concepto_id,
        subtotal: g.subtotal,
        iva: g.iva,
        iva_monto: g.iva_monto,
        total: g.total,
        moneda: g.moneda,
        tasa_cambio: g.tasa_cambio ?? 1,
        estado: g.estado,
        notas: g.notas,
        items: g.items ?? [],
        proveedor: proveedorNombre,
        tipo_sync: "factura",
        dist_configs: distConfigs,
      };
      const res = await fetch("/api/sync-factura", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({ ok: false, error: "respuesta no JSON" }));
      if (!res.ok || !data.ok) {
        alert(`Error al re-sincronizar: ${data.error ?? res.status}`);
      } else {
        alert(`Factura ${g.numero_factura ?? `#${g.id}`} re-sincronizada al Sheet.`);
      }
    } catch (err) {
      alert("Error: " + (err as Error).message);
    }
  }

  const estadoBadge = (e: GastoEstado) => {
    const map: Record<GastoEstado, string> = { pagado: "badge-success", pendiente: "badge-danger", parcial: "badge-warning" };
    const label: Record<GastoEstado, string> = { pagado: "Pagado", pendiente: "Pendiente", parcial: "Parcial" };
    return <span className={`badge ${map[e]}`}>{label[e]}</span>;
  };

  const selectedProveedor = proveedores.find(c => c.id === (form.contacto_id !== "" ? Number(form.contacto_id) : -1));

  return (
    <>
      <PageHeader
        title="Facturas de proveedor"
        description="Facturas recibidas de proveedores y sus estados de pago"
        action={<button className="btn btn-primary" onClick={() => openNew()}><Plus className="w-4 h-4" /> Nueva factura</button>}
      />

      {Object.keys(totalPorMoneda).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {Object.entries(totalPorMoneda).map(([cur, { total: t, pendiente: p }]) => (
            <div key={cur} className="card py-3">
              <p className="text-xs text-[var(--muted)]">Total {cur}</p>
              <p className="text-lg font-semibold text-red-600">{formatMoney(t, cur as CurrencyCode, country.locale)}</p>
              {p > 0 && <p className="text-xs text-amber-600 mt-1">Por pagar: {formatMoney(p, cur as CurrencyCode, country.locale)}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <select className="select w-auto" value={filterEstado} onChange={e => setFilterEstado(e.target.value as "todos" | GastoEstado)}>
            <option value="todos">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="parcial">Parcial</option>
            <option value="pagado">Pagado</option>
          </select>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input className="input pl-9 sm:w-72" placeholder="Buscar por descripción o N° factura…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--muted)]" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Receipt className="w-6 h-6" />}
            title={gastos?.length ? "Sin resultados" : "Aún no hay facturas"}
            description="Registrá las facturas recibidas de tus proveedores."
            action={!gastos?.length && <button className="btn btn-primary" onClick={() => openNew()}><Plus className="w-4 h-4" /> Nueva factura</button>}
          />
        ) : (
          <>
          <table className="table text-sm w-full">
            <colgroup>
              <col style={{ width: "32px" }} />
              <col style={{ width: "1%" }} />
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
                <th className="w-8"></th>
                <SortHeader label="N° Factura" sortKey="numero_factura" active={sortBy === "numero_factura"} dir={sortDir} onToggle={toggleSort} className="whitespace-nowrap" />
                <SortHeader label="Proveedor" sortKey="proveedor" active={sortBy === "proveedor"} dir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Creación" sortKey="fecha" active={sortBy === "fecha"} dir={sortDir} onToggle={toggleSort} className="whitespace-nowrap" />
                <SortHeader label="Vencimiento" sortKey="fecha_vencimiento" active={sortBy === "fecha_vencimiento"} dir={sortDir} onToggle={toggleSort} className="whitespace-nowrap" />
                <SortHeader label="Estado" sortKey="estado" active={sortBy === "estado"} dir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Total" sortKey="total" align="right" className="text-right whitespace-nowrap" active={sortBy === "total"} dir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Pagado" sortKey="pagado" align="right" className="text-right whitespace-nowrap" active={sortBy === "pagado"} dir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Por pagar" sortKey="por_pagar" align="right" className="text-right whitespace-nowrap" active={sortBy === "por_pagar"} dir={sortDir} onToggle={toggleSort} />
                <th className="text-right whitespace-nowrap">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(g => {
                const isExpanded = expandedIds.has(g.id);
                const items = (g.items ?? []) as FacturaItem[];
                const pagosVinculados = (pagosData ?? []).filter(p =>
                  (p.factura_pagos ?? []).some(fp => fp.factura_id === g.id)
                );
                const ncsVinculadas = (notasData ?? []).filter(n => {
                  type AP = { factura_id: number };
                  const aps = ((n as unknown as { factura_aplicaciones?: AP[] }).factura_aplicaciones) ?? [];
                  if (aps.some(a => a.factura_id === g.id)) return true;
                  return n.gasto_relacionado_id === g.id;
                });
                return (
                <Fragment key={g.id}>
                <tr
                  className="cursor-pointer"
                  onClick={(e) => {
                    // Solo expandir si el click no fue en un link/botón
                    const target = e.target as HTMLElement;
                    if (target.closest("a, button")) return;
                    toggleExpand(g.id);
                  }}
                >
                  <td className="text-slate-400">
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </td>
                  <td className="font-medium whitespace-nowrap">
                    <Link
                      href={`/egresos/facturas/${g.id}`}
                      className="hover:underline hover:text-[var(--primary)]"
                    >
                      {g.numero_factura || `#${g.id}`}
                    </Link>
                  </td>
                  <td>
                    {g.contacto_id
                      ? <Link href={`/contactos/${g.contacto_id}`} className="hover:underline hover:text-[var(--primary)]">{contactos?.find(c => c.id === g.contacto_id)?.nombre ?? `#${g.contacto_id}`}</Link>
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap text-[var(--muted)]">{formatDate(g.fecha, country.locale)}</td>
                  <td className="whitespace-nowrap text-[var(--muted)]">{g.fecha_vencimiento ? formatDate(g.fecha_vencimiento, country.locale) : "—"}</td>
                  <td>{estadoBadge(g.estado)}</td>
                  <td className="text-right font-semibold text-red-600 whitespace-nowrap">{formatMoney(Number(g.total), g.moneda, country.locale)}</td>
                  <td className="text-right text-[var(--muted)] whitespace-nowrap">
                    {formatMoney(efectivoPagadoByFactura[g.id] ?? 0, g.moneda, country.locale)}
                  </td>
                  <td className="text-right font-medium text-amber-600 whitespace-nowrap">
                    {formatMoney(
                      Math.max(0, Math.round((Number(g.total) - (cashPaidByFactura[g.id] ?? 0) - (creditByFactura[g.id] ?? 0) - (anticipoByFactura[g.id] ?? 0)) * 100) / 100),
                      g.moneda, country.locale
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {g.estado !== "pagado" && (
                      <Link
                        className="btn btn-ghost p-1.5 text-blue-600"
                        href={g.contacto_id ? `/egresos/pagos?nuevo=1&proveedor=${g.contacto_id}&factura=${g.id}` : `/egresos/pagos?nuevo=1&factura=${g.id}`}
                        title="Agregar pago"
                      >
                        <CreditCard className="w-4 h-4" />
                      </Link>
                    )}
                    <button
                      className="btn btn-ghost p-1.5 text-emerald-600"
                      onClick={() => resyncFactura(g)}
                      title="Re-sincronizar al Sheet"
                    ><RefreshCw className="w-4 h-4" /></button>
                    <button
                      className="btn btn-ghost p-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
                      onClick={() => openEdit(g)}
                      disabled={Number(g.monto_pagado) > 0}
                      title={Number(g.monto_pagado) > 0 ? "Tiene pagos o notas de crédito registrados" : "Editar"}
                    ><Pencil className="w-4 h-4" /></button>
                    <button
                      className="btn btn-ghost p-1.5 text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      onClick={() => remove(g)}
                      disabled={Number(g.monto_pagado) > 0}
                      title={Number(g.monto_pagado) > 0 ? "Tiene pagos o notas de crédito registrados" : "Eliminar"}
                    ><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-slate-50/50 border-b border-[var(--border)]">
                    <td></td>
                    <td colSpan={9} className="py-3 px-4">
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        {/* Items */}
                        <div>
                          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Ítems ({items.length})</h4>
                          {items.length === 0 ? (
                            <p className="text-xs text-slate-400">Sin ítems detallados</p>
                          ) : (
                            <ul className="text-xs space-y-1">
                              {items.map((it, i) => (
                                <li key={i} className="flex items-center justify-between gap-2 py-1 border-b border-[var(--border)] last:border-0">
                                  <span className="text-slate-600 truncate">
                                    {it.concepto_nombre}
                                    {it.cantidad > 1 && <span className="text-slate-400"> ×{it.cantidad}</span>}
                                  </span>
                                  <span className="font-medium whitespace-nowrap">{formatMoney(Number(it.total), g.moneda, country.locale)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {g.notas && (
                            <p className="text-xs text-slate-500 mt-2 italic">📝 {g.notas}</p>
                          )}
                        </div>

                        {/* Pagos */}
                        <div>
                          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Pagos ({pagosVinculados.length})</h4>
                          {pagosVinculados.length === 0 ? (
                            <p className="text-xs text-slate-400">Sin pagos registrados</p>
                          ) : (
                            <ul className="text-xs space-y-1">
                              {pagosVinculados.map(p => {
                                const fp = (p.factura_pagos ?? []).find(x => x.factura_id === g.id);
                                return (
                                  <li key={p.id} className="flex items-center justify-between gap-2 py-1 border-b border-[var(--border)] last:border-0">
                                    <Link href={`/egresos/pagos/${p.id}`} className="text-slate-600 hover:text-[var(--primary)] hover:underline">
                                      Pago #{p.id} · {formatDate(p.fecha, country.locale)}
                                    </Link>
                                    <span className="font-medium text-emerald-600 whitespace-nowrap">
                                      {formatMoney(Number(fp?.monto ?? 0), g.moneda, country.locale)}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>

                        {/* NCs */}
                        <div>
                          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Notas de crédito ({ncsVinculadas.length})</h4>
                          {ncsVinculadas.length === 0 ? (
                            <p className="text-xs text-slate-400">Sin NCs aplicadas</p>
                          ) : (
                            <ul className="text-xs space-y-1">
                              {ncsVinculadas.map(n => {
                                type AP = { factura_id: number; monto: number };
                                const aps = ((n as unknown as { factura_aplicaciones?: AP[] }).factura_aplicaciones) ?? [];
                                const apMonto = aps.find(a => a.factura_id === g.id)?.monto ?? Number(n.monto);
                                return (
                                  <li key={n.id} className="flex items-center justify-between gap-2 py-1 border-b border-[var(--border)] last:border-0">
                                    <Link href={`/ingresos/notas-credito?editar=${n.id}`} className="text-slate-600 hover:text-[var(--primary)] hover:underline">
                                      NC {n.numero ?? `#${n.id}`} · {formatDate(n.fecha, country.locale)}
                                    </Link>
                                    <span className="font-medium text-teal-600 whitespace-nowrap">
                                      {formatMoney(Number(apMonto), n.moneda, country.locale)}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
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
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Editar factura" : "Nueva factura de proveedor"} size="xl">
        <div className="space-y-5">
          {editing && (
            <EntityMeta entity="gastos" entityId={editing.id} variant="block" />
          )}

          {/* Moneda + tasa de cambio */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="label whitespace-nowrap">Moneda *</label>
              <select
                className="select w-44"
                value={form.moneda}
                onChange={e => setForm({ ...form, moneda: e.target.value as CurrencyCode, tasa_cambio: getLastTasa(e.target.value) })}
              >
                {monedas.map(code => <option key={code} value={code}>{code} — {CURRENCIES[code].name}</option>)}
              </select>
            </div>
            {isForeignCurrency && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex-wrap">
                <span className="text-sm text-amber-800 whitespace-nowrap">
                  1 {form.moneda} =
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input w-32 text-sm py-1"
                  placeholder="Tasa"
                  value={form.tasa_cambio || ""}
                  onChange={e => setForm({ ...form, tasa_cambio: parseFloat(e.target.value) || 0 })}
                />
                <span className="text-sm text-amber-800 whitespace-nowrap">{base}</span>
                <TasaCambioButton
                  moneda={form.moneda}
                  fecha={form.fecha}
                  onChange={(v) => setForm(f => ({ ...f, tasa_cambio: v }))}
                />
              </div>
            )}
          </div>

          {/* Document header */}
          <div className="border border-[var(--border)] rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">{config?.empresa_nombre}</p>
                {config?.empresa_tax_id && <p className="text-xs text-[var(--muted)]">CUIT: {config.empresa_tax_id}</p>}
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium whitespace-nowrap">No. *</label>
                <input className="input w-44 text-sm" placeholder="0001-00012345" value={form.numero_factura} onChange={e => setForm({ ...form, numero_factura: e.target.value })} />
              </div>
            </div>

            {/* Proveedor + Dates */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="label">Proveedor *</label>
                    <Link href="/contactos" className="text-xs text-[var(--primary)] hover:underline">+ Nuevo proveedor</Link>
                  </div>
                  <SearchableSelect
                    value={form.contacto_id}
                    onChange={v => setForm({ ...form, contacto_id: v === "" ? "" : Number(v) })}
                    options={proveedores.map(c => ({ value: c.id, label: c.nombre }))}
                    placeholder="— Sin proveedor —"
                    emptyLabel="— Sin proveedor —"
                  />
                </div>
                {selectedProveedor?.tax_id && (
                  <div>
                    <label className="label">Identificación</label>
                    <input className="input bg-slate-50 text-sm" value={selectedProveedor.tax_id} readOnly />
                  </div>
                )}
                {selectedProveedor?.telefono && (
                  <div>
                    <label className="label">Teléfono</label>
                    <input className="input bg-slate-50 text-sm" value={selectedProveedor.telefono} readOnly />
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <div>
                  <label className="label">Fecha de creación *</label>
                  <input type="date" className="input" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} required />
                </div>
                <div>
                  <label className="label">Vencimiento *</label>
                  <input type="date" className="input" min={form.fecha} value={form.fecha_vencimiento} onChange={e => setForm({ ...form, fecha_vencimiento: e.target.value })} />
                </div>
              </div>
            </div>
          </div>

          {/* Items table */}
          <div className="border border-[var(--border)] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-[var(--border)]">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-[var(--muted)]">Concepto *</th>
                    <th className="text-left px-3 py-2 font-medium text-[var(--muted)] w-32">Precio *</th>
                    <th className="text-left px-3 py-2 font-medium text-[var(--muted)] w-24">IVA%</th>
                    <th className="text-left px-3 py-2 font-medium text-[var(--muted)] w-20">Cant.</th>
                    <th className="text-left px-3 py-2 font-medium text-[var(--muted)]">Observaciones</th>
                    <th className="text-right px-3 py-2 font-medium text-[var(--muted)] w-32">Total</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {form.items.map(item => (
                    <tr key={item.key} className="hover:bg-slate-50/50">
                      <td className="px-3 py-2">
                        <SearchableSelect
                          size="sm"
                          value={item.concepto_id}
                          onChange={v => updateItem(item.key, { concepto_id: v })}
                          options={conceptos.map(c => ({ value: c.id, label: c.nombre }))}
                          placeholder="Seleccionar"
                          emptyLabel="— Sin concepto —"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" step="0.01" min="0" className="input text-sm py-1 w-full" placeholder="0.00"
                          value={item.precio || ""} onChange={e => updateItem(item.key, { precio: parseFloat(e.target.value) || 0 })} />
                      </td>
                      <td className="px-3 py-2">
                        <select className="select text-sm py-1 w-full" value={item.impuesto} onChange={e => updateItem(item.key, { impuesto: parseFloat(e.target.value) })}>
                          {country.ivaRates.map(r => <option key={r} value={r}>{r}%</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" step="1" min="1" className="input text-sm py-1 w-full"
                          value={item.cantidad || ""} onChange={e => updateItem(item.key, { cantidad: parseFloat(e.target.value) || 1 })} />
                      </td>
                      <td className="px-3 py-2">
                        <input className="input text-sm py-1 w-full" placeholder="Opcional"
                          value={item.observaciones} onChange={e => updateItem(item.key, { observaciones: e.target.value })} />
                      </td>
                      <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                        {formatMoney(itemTotal(item), form.moneda, country.locale)}
                      </td>
                      <td className="px-2 py-2">
                        {form.items.length > 1 && (
                          <button type="button" className="text-[var(--muted)] hover:text-red-500" onClick={() => removeItem(item.key)}>
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 border-t border-[var(--border)] bg-slate-50/50">
              <button type="button" className="text-sm text-[var(--primary)] hover:underline flex items-center gap-1 font-medium" onClick={addItem}>
                <Plus className="w-3.5 h-3.5" /> Agregar línea
              </button>
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="space-y-1 text-sm w-64">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Subtotal</span>
                <span className="font-medium">{formatMoney(totals.subtotal, form.moneda, country.locale)}</span>
              </div>
              {totals.iva_monto > 0 && (
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">IVA</span>
                  <span className="font-medium">{formatMoney(totals.iva_monto, form.moneda, country.locale)}</span>
                </div>
              )}
              <div className="flex justify-between pt-1 border-t border-[var(--border)]">
                <span className="font-semibold">Total {form.moneda}</span>
                <span className="font-bold text-base">{formatMoney(totals.total, form.moneda, country.locale)}</span>
              </div>
              {isForeignCurrency && form.tasa_cambio > 0 && (
                <div className="flex justify-between text-amber-700 bg-amber-50 -mx-2 px-2 py-1 rounded">
                  <span className="font-semibold">Total {base}</span>
                  <span className="font-bold">{formatMoney(totals.total_base, base, country.locale)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Notas */}
          <div>
            <label className="label">Notas</label>
            <textarea className="textarea" rows={2} value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-[var(--border)]">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => handleSave("new")}>Guardar y crear nueva</button>
            {form.contacto_id !== "" && (
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => handleSave("pay")}>Guardar y agregar pago</button>
            )}
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => handleSave("save")}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
