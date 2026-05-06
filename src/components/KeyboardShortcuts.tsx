"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Keyboard, X } from "lucide-react";

const SHORTCUTS = [
  { keys: ["Ctrl/⌘", "K"], desc: "Búsqueda global (todo)" },
  { keys: ["/"], desc: "Búsqueda global (todo)" },
  { keys: ["N"], desc: "Crear nuevo (según página actual)" },
  { keys: ["G", "F"], desc: "Ir a Facturas" },
  { keys: ["G", "P"], desc: "Ir a Pagos" },
  { keys: ["G", "I"], desc: "Ir a Ingresos / Pagos recibidos" },
  { keys: ["G", "C"], desc: "Ir a Contactos" },
  { keys: ["G", "D"], desc: "Ir al Dashboard" },
  { keys: ["G", "R"], desc: "Ir a Reportes" },
  { keys: ["?"], desc: "Mostrar esta ayuda" },
  { keys: ["Esc"], desc: "Cerrar modal o búsqueda" },
];

export default function KeyboardShortcuts() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const [chord, setChord] = useState<string | null>(null);

  useEffect(() => {
    let chordTimeout: ReturnType<typeof setTimeout> | null = null;

    function isTyping(e: KeyboardEvent): boolean {
      const t = e.target as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t.isContentEditable
      );
    }

    function onKey(e: KeyboardEvent) {
      // Si está escribiendo, no aplicar atajos (excepto Esc que se maneja por modal)
      if (isTyping(e)) return;

      // ? → ayuda
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setHelpOpen(v => !v);
        return;
      }

      // N → emitir evento "app:new" que cada página puede escuchar
      if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("app:new"));
        return;
      }

      // Chord G + X
      if (e.key.toLowerCase() === "g" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setChord("g");
        if (chordTimeout) clearTimeout(chordTimeout);
        chordTimeout = setTimeout(() => setChord(null), 1500);
        return;
      }

      if (chord === "g") {
        const k = e.key.toLowerCase();
        const map: Record<string, string> = {
          f: "/egresos/facturas",
          p: "/egresos/pagos",
          i: "/ingresos/pagos-recibidos",
          c: "/contactos",
          d: "/",
          r: "/reportes",
          n: "/ingresos/notas-credito",
          o: "/conceptos",
          u: "/cuentas",
        };
        if (map[k]) {
          e.preventDefault();
          router.push(map[k]);
        }
        setChord(null);
        if (chordTimeout) clearTimeout(chordTimeout);
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (chordTimeout) clearTimeout(chordTimeout);
    };
  }, [router, chord]);

  return (
    <>
      {/* Indicador de chord activo */}
      {chord === "g" && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] bg-slate-900 text-white text-xs px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-2">
          <kbd className="bg-white/20 px-1.5 py-0.5 rounded text-[10px]">G</kbd>
          <span>+</span>
          <span className="text-slate-300">F/P/I/C/D/R/N/O/U…</span>
        </div>
      )}

      {/* Modal de ayuda */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-[var(--border)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <Keyboard className="w-5 h-5 text-[var(--primary)]" />
                <h3 className="font-semibold">Atajos de teclado</h3>
              </div>
              <button
                onClick={() => setHelpOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-2">
              {SHORTCUTS.map((s, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-600">{s.desc}</span>
                  <div className="flex items-center gap-1">
                    {s.keys.map((k, j) => (
                      <span key={j} className="flex items-center gap-1">
                        {j > 0 && <span className="text-slate-300 text-xs">+</span>}
                        <kbd className="bg-slate-100 border border-slate-200 text-slate-700 px-2 py-0.5 rounded text-[11px] font-medium min-w-[22px] text-center">
                          {k}
                        </kbd>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-[var(--border)] text-xs text-slate-500">
              Los atajos no se activan mientras estás escribiendo en un campo.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
