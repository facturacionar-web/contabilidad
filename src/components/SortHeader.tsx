"use client";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import type { SortDir } from "@/lib/useSortable";

type Props = {
  label: string;
  sortKey: string;
  active: boolean;
  dir: SortDir;
  onToggle: (key: string) => void;
  className?: string;
  align?: "left" | "right" | "center";
};

export default function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onToggle,
  className = "",
  align = "left",
}: Props) {
  const Icon = !active
    ? ChevronsUpDown
    : dir === "asc"
    ? ChevronUp
    : ChevronDown;

  const justify =
    align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";

  return (
    <th className={`${className} cursor-pointer select-none`}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={`flex items-center gap-1 ${justify} w-full hover:text-[var(--primary)] transition-colors ${
          active ? "text-[var(--primary)]" : ""
        }`}
      >
        <span>{label}</span>
        <Icon className={`w-3.5 h-3.5 ${active ? "opacity-100" : "opacity-40"}`} />
      </button>
    </th>
  );
}
