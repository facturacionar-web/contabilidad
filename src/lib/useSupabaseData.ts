"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  Contacto,
  Ingreso,
  Gasto,
  NotaCredito,
  Concepto,
  Cuenta,
} from "./types";

type TableMap = {
  contactos: Contacto;
  ingresos: Ingreso;
  gastos: Gasto;
  notas_credito: NotaCredito;
  conceptos: Concepto;
  cuentas: Cuenta;
};

// Tablas que soportan soft delete (tienen columna deleted_at)
const SOFT_DELETE_TABLES: ReadonlySet<keyof TableMap> = new Set([
  "contactos",
  "ingresos",
  "gastos",
  "notas_credito",
  "conceptos",
  "cuentas",
]);

function isSoftDelete(table: keyof TableMap): boolean {
  return SOFT_DELETE_TABLES.has(table);
}

export type SoftDeleteFilter = "active" | "deleted" | "all";

// ── Cache global compartido entre componentes ────────────────────────────────
// Evita que cada página/componente vuelva a fetchear los mismos datos.
// staleTime: cuánto tiempo se considera fresco antes de re-fetchear (30 seg).

const STALE_TIME_MS = 30_000;

type CacheEntry = {
  data: unknown[] | undefined;
  error: string | null;
  ts: number;                       // last-fetched timestamp (0 = never)
  pending: Promise<void> | null;
  subscribers: Set<() => void>;
};

const cache = new Map<string, CacheEntry>();

function makeKey(
  table: string,
  filter: { column: string; op: "eq"; value: unknown }[] | undefined,
  orderBy: string,
  ascending: boolean,
  softDeleteFilter: SoftDeleteFilter,
): string {
  return JSON.stringify({ t: table, f: filter ?? null, o: orderBy, a: ascending, s: softDeleteFilter });
}

function getEntry(key: string): CacheEntry {
  let e = cache.get(key);
  if (!e) {
    e = { data: undefined, error: null, ts: 0, pending: null, subscribers: new Set() };
    cache.set(key, e);
  }
  return e;
}

function notify(key: string) {
  const e = cache.get(key);
  if (!e) return;
  for (const sub of e.subscribers) {
    try { sub(); } catch { /* ignore */ }
  }
}

async function fetchInto(
  key: string,
  table: keyof TableMap,
  filter: { column: string; op: "eq"; value: unknown }[] | undefined,
  orderBy: string,
  ascending: boolean,
  softDeleteFilter: SoftDeleteFilter,
): Promise<void> {
  const e = getEntry(key);
  if (e.pending) return e.pending;
  e.pending = (async () => {
    try {
      const supabase = createClient();
      let query = supabase.from(table).select("*");
      if (filter) {
        for (const f of filter) query = query.eq(f.column, f.value as never);
      }
      if (isSoftDelete(table)) {
        if (softDeleteFilter === "active") query = query.is("deleted_at", null);
        else if (softDeleteFilter === "deleted") query = query.not("deleted_at", "is", null);
      }
      query = query.order(orderBy, { ascending });
      const { data, error } = await query;
      if (error) {
        e.error = error.message;
        e.data = [];
      } else {
        e.error = null;
        e.data = data ?? [];
      }
      e.ts = Date.now();
    } catch (err) {
      e.error = err instanceof Error ? err.message : String(err);
      e.data = [];
      e.ts = Date.now();
    } finally {
      e.pending = null;
      notify(key);
    }
  })();
  return e.pending;
}

/** Invalida el cache de una tabla (ej: después de insert/update/delete) */
export function invalidateTableCache(table: keyof TableMap | "all"): void {
  for (const [key, e] of cache) {
    if (table === "all" || key.includes(`"t":"${table}"`)) {
      e.ts = 0;
      // Disparar refetch pasivo: cuando un subscriber re-renderice, va a ver ts=0 y llamar fetch
      // Pero también podemos forzar el refetch acá:
      notify(key);
    }
  }
}

export function useTable<K extends keyof TableMap>(
  table: K,
  opts: {
    orderBy?: string;
    ascending?: boolean;
    filter?: { column: string; op: "eq"; value: unknown }[];
    deps?: unknown[];
    skip?: boolean;
    softDeleteFilter?: SoftDeleteFilter;
  } = {}
) {
  const {
    orderBy = "id",
    ascending = false,
    filter,
    deps = [],
    skip = false,
    softDeleteFilter = "active",
  } = opts;

  const filterStr = JSON.stringify(filter ?? null);
  const key = makeKey(table, filter, orderBy, ascending, softDeleteFilter);
  const entry = getEntry(key);

  const [, setRev] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Suscribirse al cache para actualizar cuando cambien los datos
  useEffect(() => {
    const sub = () => { if (mounted.current) setRev((r) => r + 1); };
    entry.subscribers.add(sub);
    return () => { entry.subscribers.delete(sub); };
  }, [entry]);

  // Disparar fetch si no hay datos o están stale
  useEffect(() => {
    if (skip) return;
    const stale = Date.now() - entry.ts > STALE_TIME_MS;
    if (entry.data === undefined || stale) {
      void fetchInto(key, table, filter, orderBy, ascending, softDeleteFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, skip, ...deps]);

  const reload = useCallback(async () => {
    entry.ts = 0;
    await fetchInto(key, table, filter, orderBy, ascending, softDeleteFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Si skip está activo, devolver undefined / loading false
  if (skip) {
    return {
      data: undefined as TableMap[K][] | undefined,
      error: null as string | null,
      reload,
      loading: false,
    };
  }

  // referencia a filterStr para que el dep array reaccione a cambios en filter
  void filterStr;

  return {
    data: entry.data as TableMap[K][] | undefined,
    error: entry.error,
    reload,
    loading: entry.data === undefined,
  };
}

/** Helper: filter para aislar datos por país */
export function paisFilter(pais: string | null | undefined) {
  return pais ? [{ column: "ctx_pais", op: "eq" as const, value: pais }] : undefined;
}

// ── Activity log ─────────────────────────────────────────────────────────────
export type ActivityAction = "create" | "update" | "delete" | "restore" | "purge";

async function logActivity(payload: {
  action: ActivityAction;
  entity: string;
  entity_id: string;
  entity_label?: string;
  changes?: unknown;
  ctx_pais?: string | null;
}): Promise<void> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("activity_log").insert({
      user_id: user.id,
      user_email: user.email ?? null,
      ctx_pais: payload.ctx_pais ?? null,
      action: payload.action,
      entity: payload.entity,
      entity_id: payload.entity_id,
      entity_label: payload.entity_label ?? null,
      changes: payload.changes ?? null,
    } as never);
  } catch (e) {
    console.warn("[logActivity] failed:", e);
  }
}

function deriveLabel<K extends keyof TableMap>(table: K, row: Partial<TableMap[K]>): string | undefined {
  const r = row as Record<string, unknown>;
  if (table === "contactos") return r.nombre as string | undefined;
  if (table === "conceptos") return r.nombre as string | undefined;
  if (table === "cuentas") return r.nombre as string | undefined;
  if (table === "gastos") {
    const num = r.numero_factura as string | undefined;
    const concepto = r.concepto as string | undefined;
    return num ? `Factura ${num}` : concepto;
  }
  if (table === "ingresos") return r.concepto as string | undefined;
  if (table === "notas_credito") {
    const num = r.numero as string | undefined;
    return num ? `NC ${num}` : (r.concepto as string | undefined);
  }
  return undefined;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function insertRow<K extends keyof TableMap>(
  table: K,
  row: Partial<TableMap[K]>
): Promise<TableMap[K]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");
  const effectiveId = (user.user_metadata?.owner_id as string | undefined) ?? user.id;
  const { data, error } = await supabase
    .from(table)
    .insert({ ...row, user_id: effectiveId } as never)
    .select()
    .single();
  if (error) throw new Error(error.message);
  const inserted = data as TableMap[K];
  const r = inserted as unknown as { id: string | number; ctx_pais?: string | null };
  invalidateTableCache(table);
  void logActivity({
    action: "create",
    entity: table,
    entity_id: String(r.id),
    entity_label: deriveLabel(table, row),
    changes: row,
    ctx_pais: r.ctx_pais ?? null,
  });
  return inserted;
}

export async function updateRow<K extends keyof TableMap>(
  table: K,
  id: number | string,
  patch: Partial<TableMap[K]>
) {
  const supabase = createClient();
  const { error } = await supabase
    .from(table)
    .update(patch as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
  const r = patch as Record<string, unknown>;
  invalidateTableCache(table);
  void logActivity({
    action: "update",
    entity: table,
    entity_id: String(id),
    entity_label: deriveLabel(table, patch),
    changes: patch,
    ctx_pais: (r.ctx_pais as string | undefined) ?? null,
  });
}

/**
 * Borrado de un registro.
 * - Para tablas con soft delete: pone `deleted_at = now()` (recuperable desde Papelera)
 * - Para tablas sin soft delete: hace DELETE real
 */
export async function deleteRow<K extends keyof TableMap>(
  table: K,
  id: number | string
) {
  const supabase = createClient();
  if (isSoftDelete(table)) {
    const { error } = await supabase
      .from(table)
      .update({ deleted_at: new Date().toISOString() } as never)
      .eq("id", id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  // Desconciliar movimientos bancarios que apuntaban a este registro
  // (cuando se borra un pago o ingreso, vuelve a "pendiente" en la conciliación)
  if (table === "gastos" || table === "ingresos") {
    try {
      const matchedType = table === "gastos" ? "pago" : "ingreso";
      await supabase
        .from("conciliacion_movimientos")
        .update({
          matched_id: null,
          matched_type: null,
          matched_by: null,
          matched_score: null,
          estado: "pendiente",
          reconciled_at: null,
        } as never)
        .eq("matched_type", matchedType)
        .eq("matched_id", id);
    } catch (e) {
      console.warn("[deleteRow] no se pudo desconciliar:", e);
    }
  }

  invalidateTableCache(table);
  void logActivity({
    action: "delete",
    entity: table,
    entity_id: String(id),
  });
}

/** Restaurar un registro soft-deleted (vuelve a estar visible) */
export async function restoreRow<K extends keyof TableMap>(
  table: K,
  id: number | string
) {
  const supabase = createClient();
  if (!isSoftDelete(table)) throw new Error(`Tabla ${table} no soporta restore`);
  const { error } = await supabase
    .from(table)
    .update({ deleted_at: null } as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
  invalidateTableCache(table);
  void logActivity({
    action: "restore",
    entity: table,
    entity_id: String(id),
  });
}

/**
 * Revierte las aplicaciones de anticipos antes de eliminar un gasto.
 * - Si es un PAGO (anticipo): revierte cada aplicación del monto_pagado de la factura asociada
 *   y elimina la fila de anticipos_aplicaciones.
 * - Si es una FACTURA: solo elimina las filas de anticipos_aplicaciones donde aparece como destino.
 *   El saldo del anticipo se recalcula dinámicamente.
 *
 * Llamar SIEMPRE antes de deleteRow("gastos", id) cuando hay riesgo de relaciones.
 */
export async function cascadeAnticiposBeforeDeleteGasto(gastoId: number | string) {
  const supabase = createClient();
  const { data: gasto } = await supabase.from("gastos").select("id,tipo").eq("id", gastoId).maybeSingle();
  if (!gasto) return;

  if (gasto.tipo === "gasto") {
    // Pago: si era anticipo aplicado, revertir en facturas
    const { data: aps } = await supabase
      .from("anticipos_aplicaciones")
      .select("id,factura_id,monto")
      .eq("anticipo_pago_id", gastoId);
    if (aps && aps.length > 0) {
      for (const ap of aps) {
        const { data: factura } = await supabase
          .from("gastos")
          .select("id,total,monto_pagado,numero_factura")
          .eq("id", ap.factura_id)
          .maybeSingle();
        if (!factura) continue;
        const nuevoPagado = Math.max(0, Math.round((Number(factura.monto_pagado) - Number(ap.monto)) * 100) / 100);
        const total = Number(factura.total);
        const nuevoEstado = nuevoPagado <= 0 ? "pendiente"
          : nuevoPagado >= total - 0.001 ? "pagado"
          : "parcial";
        await supabase
          .from("gastos")
          .update({ monto_pagado: nuevoPagado, estado: nuevoEstado } as never)
          .eq("id", ap.factura_id);
        // Log indirecto: factura modificada por cascade
        const f = factura as { id: number; numero_factura?: string | null };
        void logActivity({
          action: "update",
          entity: "gastos",
          entity_id: String(ap.factura_id),
          entity_label: `Factura ${f.numero_factura ?? `#${ap.factura_id}`}`,
          changes: {
            _cascade_from: { type: "anticipo_eliminado", anticipo_pago_id: gastoId, monto_revertido: Number(ap.monto) },
            monto_pagado: nuevoPagado,
            estado: nuevoEstado,
          },
        });
      }
      await supabase.from("anticipos_aplicaciones").delete().eq("anticipo_pago_id", gastoId);
    }
  } else if (gasto.tipo === "factura_proveedor") {
    // Factura: solo borrar aplicaciones (el saldo del anticipo se recalcula solo)
    const { data: aps } = await supabase
      .from("anticipos_aplicaciones")
      .select("id,anticipo_pago_id,monto")
      .eq("factura_id", gastoId);
    await supabase.from("anticipos_aplicaciones").delete().eq("factura_id", gastoId);
    // Log indirecto: anticipos afectados (sus saldos suben)
    for (const ap of (aps ?? [])) {
      void logActivity({
        action: "update",
        entity: "gastos",
        entity_id: String(ap.anticipo_pago_id),
        changes: {
          _cascade_from: { type: "factura_eliminada", factura_id: gastoId, saldo_recuperado: Number(ap.monto) },
        },
      });
    }
  }
}

/**
 * Limpia referencias en JSONB de otras tablas antes de hacer un purge real de un gasto.
 * - Si era una factura: limpia entries de `factura_pagos` en otros pagos que la referenciaban.
 * - Si era un pago: las facturas en factura_pagos no se ven afectadas (la factura ya tenía
 *   monto_pagado revertido cuando se hizo soft delete).
 * Las anticipos_aplicaciones tienen ON DELETE CASCADE así que se limpian solas en el purge.
 */
async function cleanReferencesBeforePurge(table: string, id: number | string) {
  if (table !== "gastos") return;
  const supabase = createClient();
  const { data: gasto } = await supabase
    .from("gastos")
    .select("id,tipo")
    .eq("id", id)
    .maybeSingle();
  if (!gasto) return;

  if (gasto.tipo === "factura_proveedor") {
    // Buscar pagos que tengan factura_pagos referenciando esta factura
    const { data: pagos } = await supabase
      .from("gastos")
      .select("id,factura_pagos")
      .eq("tipo", "gasto")
      .not("factura_pagos", "is", null);
    for (const p of (pagos ?? []) as { id: number; factura_pagos: { factura_id: number }[] | null }[]) {
      const fps = (p.factura_pagos ?? []).filter(fp => fp.factura_id !== Number(id));
      if (fps.length !== (p.factura_pagos ?? []).length) {
        await supabase
          .from("gastos")
          .update({ factura_pagos: fps.length > 0 ? fps : null } as never)
          .eq("id", p.id);
      }
    }
    // También limpiar conciliacion_movimientos que apuntaban a esta factura
    await supabase
      .from("conciliacion_movimientos")
      .update({
        matched_id: null,
        matched_type: null,
        matched_by: null,
        matched_score: null,
        estado: "pendiente",
        reconciled_at: null,
      } as never)
      .eq("matched_type", "pago")  // Las facturas no se concilian directo, los pagos sí
      .eq("matched_id", id);
    // Las notas_credito que tenían gasto_relacionado_id apuntando a esta factura
    await supabase
      .from("notas_credito")
      .update({ gasto_relacionado_id: null } as never)
      .eq("gasto_relacionado_id", id);
  } else if (gasto.tipo === "gasto") {
    // Pago: limpiar conciliación
    await supabase
      .from("conciliacion_movimientos")
      .update({
        matched_id: null,
        matched_type: null,
        matched_by: null,
        matched_score: null,
        estado: "pendiente",
        reconciled_at: null,
      } as never)
      .eq("matched_type", "pago")
      .eq("matched_id", id);
  }
}

/** Borrado definitivo (purge) — solo para registros ya soft-deleted o tablas sin soft delete */
export async function purgeRow<K extends keyof TableMap>(
  table: K,
  id: number | string
) {
  const supabase = createClient();
  await cleanReferencesBeforePurge(table, id);
  // Para ingresos, también limpiar conciliacion_movimientos que apuntaban a este ingreso
  if (table === "ingresos") {
    await supabase
      .from("conciliacion_movimientos")
      .update({
        matched_id: null,
        matched_type: null,
        matched_by: null,
        matched_score: null,
        estado: "pendiente",
        reconciled_at: null,
      } as never)
      .eq("matched_type", "ingreso")
      .eq("matched_id", id);
  }
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw new Error(error.message);
  invalidateTableCache(table);
  void logActivity({
    action: "purge",
    entity: table,
    entity_id: String(id),
  });
}
