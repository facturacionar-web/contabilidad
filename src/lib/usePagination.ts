"use client";
import { useState, useMemo, useEffect } from "react";

export type PageSize = 25 | 50 | 100 | 250;

const PAGE_SIZES: PageSize[] = [25, 50, 100, 250];
const STORAGE_PREFIX = "alegrant.pageSize.";

/**
 * Pagina un array. Soporta:
 * - Cambio de tamaño de página (persistente por scope en localStorage)
 * - Auto-reset al cambiar `rows` (cuando filtros cambian, vuelve a página 1)
 */
export function usePagination<T>(rows: T[], scope = "default", defaultSize: PageSize = 50) {
  const [pageSize, setPageSize] = useState<PageSize>(defaultSize);
  const [page, setPage] = useState(1);

  // Cargar preferencia
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(STORAGE_PREFIX + scope);
    const n = stored ? Number(stored) : NaN;
    if (PAGE_SIZES.includes(n as PageSize)) setPageSize(n as PageSize);
  }, [scope]);

  function changePageSize(n: PageSize) {
    setPageSize(n);
    setPage(1);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_PREFIX + scope, String(n));
    }
  }

  // Cuando cambia la longitud de filas (filtros nuevos), volver a página 1
  // si la página actual ya no existe
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize]);

  const from = rows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, rows.length);

  return {
    page,
    setPage,
    pageSize,
    setPageSize: changePageSize,
    pageSizes: PAGE_SIZES,
    totalPages,
    pageRows,
    total: rows.length,
    from,
    to,
  };
}
