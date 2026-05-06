"use client";
import { useEffect } from "react";

/**
 * Handler global: cuando se hace click (o focus) en un input tipo date,
 * abre el calendar picker, en vez de obligar al usuario a apretar el ícono.
 * Usa la API showPicker() — soportada en Chrome/Edge/Safari/Firefox modernos.
 */
const DATE_TYPES = new Set(["date", "datetime-local", "month", "time", "week"]);

export default function DateInputClickHandler() {
  useEffect(() => {
    function tryShowPicker(input: HTMLInputElement) {
      // Algunos browsers tiran SecurityError fuera de un user gesture
      try {
        if (typeof input.showPicker === "function") {
          input.showPicker();
        }
      } catch {
        /* ignore */
      }
    }

    function onClick(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.tagName !== "INPUT") return;
      const input = t as HTMLInputElement;
      if (!DATE_TYPES.has(input.type)) return;
      if (input.disabled || input.readOnly) return;
      tryShowPicker(input);
    }

    function onFocus(e: FocusEvent) {
      const t = e.target as HTMLElement | null;
      if (!t || t.tagName !== "INPUT") return;
      const input = t as HTMLInputElement;
      if (!DATE_TYPES.has(input.type)) return;
      if (input.disabled || input.readOnly) return;
      tryShowPicker(input);
    }

    document.addEventListener("click", onClick);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("focusin", onFocus);
    };
  }, []);

  return null;
}
