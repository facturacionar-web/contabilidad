"use client";
import { useState, useMemo, useCallback } from "react";

export type SortDir = "asc" | "desc";

/**
 * Hook genérico para ordenar tablas en cliente.
 *
 * Uso:
 *   const { sortBy, sortDir, toggleSort, sorted } = useSortable(rows, {
 *     getValue: (row, key) => key === "total" ? row.total : row[key],
 *     initial: { key: "fecha", dir: "desc" }
 *   });
 *
 *   <th onClick={() => toggleSort("fecha")}>
 *     Fecha <SortIcon active={sortBy === "fecha"} dir={sortDir} />
 *   </th>
 */
export function useSortable<T>(
  rows: T[] | undefined,
  options: {
    getValue: (row: T, key: string) => unknown;
    initial?: { key: string; dir?: SortDir };
  }
) {
  const [sortBy, setSortBy] = useState<string | null>(options.initial?.key ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(options.initial?.dir ?? "desc");

  const toggleSort = useCallback((key: string) => {
    setSortBy(prev => {
      if (prev === key) {
        // mismo campo: alternar dir
        setSortDir(d => d === "asc" ? "desc" : "asc");
        return prev;
      }
      // nuevo campo: empezar desc por defecto, asc para strings
      setSortDir("desc");
      return key;
    });
  }, []);

  const sorted = useMemo(() => {
    if (!rows) return rows;
    if (!sortBy) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = options.getValue(a, sortBy);
      const vb = options.getValue(b, sortBy);
      // null/undefined van al final
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      let cmp: number;
      if (typeof va === "number" && typeof vb === "number") {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb), "es", { numeric: true, sensitivity: "base" });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortBy, sortDir]);

  return { sortBy, sortDir, toggleSort, sorted };
}
