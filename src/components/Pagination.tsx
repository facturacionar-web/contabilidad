"use client";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import type { PageSize } from "@/lib/usePagination";

type Props = {
  page: number;
  totalPages: number;
  pageSize: number;
  pageSizes: readonly PageSize[];
  total: number;
  from: number;
  to: number;
  onPage: (p: number) => void;
  onPageSize: (n: PageSize) => void;
};

export default function Pagination({
  page, totalPages, pageSize, pageSizes, total, from, to, onPage, onPageSize,
}: Props) {
  if (total === 0) return null;

  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="px-5 py-3 border-t border-[var(--border)] flex items-center justify-between flex-wrap gap-3 text-sm">
      <div className="flex items-center gap-3 text-slate-500">
        <span>
          {from.toLocaleString("es-AR")}–{to.toLocaleString("es-AR")} de{" "}
          <span className="font-semibold text-slate-700">{total.toLocaleString("es-AR")}</span>
        </span>
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value) as PageSize)}
          className="select py-1 text-xs w-auto"
        >
          {pageSizes.map((s) => (
            <option key={s} value={s}>{s} por página</option>
          ))}
        </select>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPage(1)}
            disabled={!canPrev}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Primera página"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => onPage(page - 1)}
            disabled={!canPrev}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Página anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-3 text-xs text-slate-500 min-w-[80px] text-center">
            Página <span className="font-semibold text-slate-700">{page}</span> de {totalPages}
          </span>
          <button
            onClick={() => onPage(page + 1)}
            disabled={!canNext}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Página siguiente"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => onPage(totalPages)}
            disabled={!canNext}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Última página"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
