"use client";
import { useEffect, useState, useCallback } from "react";
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

export function useTable<K extends keyof TableMap>(
  table: K,
  opts: {
    orderBy?: string;
    ascending?: boolean;
    filter?: { column: string; op: "eq"; value: unknown }[];
    deps?: unknown[];
    skip?: boolean;
  } = {}
) {
  const { orderBy = "id", ascending = false, filter, deps = [], skip = false } = opts;
  const [data, setData] = useState<TableMap[K][] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (skip) return;
    const supabase = createClient();
    let query = supabase.from(table).select("*");
    if (filter) {
      for (const f of filter) query = query.eq(f.column, f.value as never);
    }
    query = query.order(orderBy, { ascending });
    const { data: rows, error } = await query;
    if (error) {
      setError(error.message);
      setData([]);
    } else {
      setError(null);
      setData(rows as TableMap[K][]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, orderBy, ascending, JSON.stringify(filter), skip]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);

  return { data, error, reload: load };
}

/** Helper: filter para aislar datos por país */
export function paisFilter(pais: string | null | undefined) {
  return pais ? [{ column: "ctx_pais", op: "eq" as const, value: pais }] : undefined;
}

export async function insertRow<K extends keyof TableMap>(
  table: K,
  row: Partial<TableMap[K]>
): Promise<TableMap[K]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");
  const { data, error } = await supabase
    .from(table)
    .insert({ ...row, user_id: user.id } as never)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as TableMap[K];
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
}

export async function deleteRow<K extends keyof TableMap>(
  table: K,
  id: number | string
) {
  const supabase = createClient();
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw new Error(error.message);
}
