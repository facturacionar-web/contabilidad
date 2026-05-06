"use client";
import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search } from "lucide-react";

type Option = { value: string | number; label: string };

export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Seleccionar…",
  emptyLabel = "— Sin seleccionar —",
  className = "",
  size = "normal",
}: {
  value: string | number | "";
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
  size?: "normal" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });

  const selectedLabel = options.find(o => String(o.value) === String(value))?.label ?? "";
  const filtered = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  function openDropdown() {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    // Check if there's enough room below; if not, open upward
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownH = Math.min(filtered.length * 36 + 56, 260);
    const top = spaceBelow < dropdownH && rect.top > dropdownH
      ? rect.top - dropdownH
      : rect.bottom;
    setCoords({ top, left: rect.left, width: rect.width });
    setOpen(true);
    setSearch("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function select(val: string | number) {
    onChange(String(val));
    setOpen(false);
    setSearch("");
  }

  // Close on outside click or outside scroll
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!(e.target as Element).closest("[data-searchable-dropdown]") && !buttonRef.current?.contains(e.target as Node))
        setOpen(false);
    }
    function onScroll(e: Event) {
      // Don't close if the scroll is happening inside the dropdown itself
      if ((e.target as Element)?.closest?.("[data-searchable-dropdown]")) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const btnClass = size === "sm"
    ? `select text-sm py-1 text-left flex items-center justify-between gap-1 w-full ${className}`
    : `select text-left flex items-center justify-between gap-2 w-full ${className}`;

  return (
    <>
      <button ref={buttonRef} type="button" className={btnClass} onClick={openDropdown}>
        <span className={`truncate flex-1 min-w-0 ${!selectedLabel ? "text-[var(--muted)]" : ""}`}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-[var(--muted)]" />
      </button>

      {open && (
        <div
          data-searchable-dropdown
          style={{ position: "fixed", top: coords.top, left: coords.left, width: Math.max(coords.width, 220), zIndex: 9999 }}
          className="bg-white border border-[var(--border)] rounded-lg shadow-xl overflow-hidden"
        >
          <div className="p-2 border-b border-[var(--border)]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                ref={inputRef}
                className="input pl-8 py-1.5 text-sm w-full"
                placeholder="Buscar…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Escape") setOpen(false);
                  if (e.key === "Enter" && filtered.length === 1) select(filtered[0].value);
                }}
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm text-[var(--muted)] hover:bg-slate-50"
              onClick={() => select("")}
            >
              {emptyLabel}
            </button>
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm text-center text-[var(--muted)]">Sin resultados</p>
            ) : (
              filtered.map(o => (
                <button
                  key={o.value}
                  type="button"
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
                    String(o.value) === String(value)
                      ? "bg-[var(--primary-soft)] text-[var(--primary-hover)] font-medium"
                      : ""
                  }`}
                  onClick={() => select(o.value)}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
