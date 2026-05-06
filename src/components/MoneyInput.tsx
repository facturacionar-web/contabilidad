"use client";
import { useState, useEffect, useRef } from "react";
import { parseMonto } from "@/lib/format";

type Props = {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Si true, fuerza máximo 2 decimales al normalizar en blur */
  maxDecimals?: number;
  /** Cuando el campo recibe foco, si vale 0, ¿selecciona todo? (default true) */
  selectOnFocus?: boolean;
};

/**
 * Input de montos que mantiene un estado local string mientras se edita.
 * Permite tipear "100.", "100.5", "1.234,56" sin perder caracteres intermedios.
 * Solo propaga el number parseado al onChange, sincroniza el local state si el value externo cambia.
 */
export default function MoneyInput({
  value,
  onChange,
  className = "input",
  placeholder = "0,00",
  disabled = false,
  maxDecimals = 2,
  selectOnFocus = true,
}: Props) {
  const [local, setLocal] = useState<string>(value > 0 ? String(value) : "");
  const lastExternal = useRef<number>(value);

  // Sincronizar local cuando el value externo cambia (sin pisar lo que el user está escribiendo)
  useEffect(() => {
    if (value !== lastExternal.current) {
      lastExternal.current = value;
      // Solo actualizar local si lo que el user tiene tipeado no coincide con el value
      if (parseMonto(local) !== value) {
        setLocal(value > 0 ? String(value) : "");
      }
    }
  }, [value, local]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    // Aceptamos solo dígitos, ".", ",", "-" y espacios (para miles)
    if (raw && !/^-?[\d.,\s]*$/.test(raw)) return;
    setLocal(raw);
    const parsed = parseMonto(raw);
    if (parsed !== value) onChange(parsed);
  }

  function handleBlur() {
    // Al perder foco normalizamos a 2 decimales para mostrar prolijo
    const n = parseMonto(local);
    if (n > 0) {
      const fixed = Number(n.toFixed(maxDecimals));
      setLocal(fixed.toString());
      if (fixed !== value) onChange(fixed);
    } else {
      setLocal("");
      if (value !== 0) onChange(0);
    }
  }

  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    if (selectOnFocus) e.target.select();
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      value={local}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      disabled={disabled}
    />
  );
}
