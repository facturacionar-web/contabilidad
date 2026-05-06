"use client";
import { useState } from "react";
import { Sparkles, Loader2, Check, AlertCircle } from "lucide-react";
import { fetchTipoCambio } from "@/lib/tipoCambio";
import type { CurrencyCode } from "@/lib/countries";

type Props = {
  moneda: CurrencyCode;
  fecha: string;
  base?: CurrencyCode;
  onChange: (valor: number) => void;
  className?: string;
};

type Status = { kind: "ok" | "err"; msg: string } | null;

export default function TasaCambioButton({
  moneda,
  fecha,
  base = "ARS",
  onChange,
  className = "",
}: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  if (moneda === base) return null;
  if (!fecha) return null;

  async function fetchTC() {
    setLoading(true);
    setStatus(null);
    try {
      const r = await fetchTipoCambio(moneda, fecha, base);
      if (!r) {
        setStatus({ kind: "err", msg: "Google Finance no respondió" });
        return;
      }
      onChange(r.valor);
      setStatus({
        kind: "ok",
        msg: `${moneda}/${base} ${r.fecha}: ${r.valor.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`,
      });
      setTimeout(() => setStatus(null), 2200);
    } catch (e) {
      setStatus({ kind: "err", msg: "Error de red" });
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`relative inline-flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={fetchTC}
        disabled={loading}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-amber-50 hover:bg-amber-100 disabled:opacity-50 border border-amber-200 text-amber-700 rounded-lg transition-colors whitespace-nowrap"
        title="Obtener tipo de cambio de Google Finance según la fecha de emisión"
      >
        {loading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Sparkles className="w-3 h-3" />
        )}
        TC del día
      </button>

      {status && (
        <span
          className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md ${
            status.kind === "ok"
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {status.kind === "ok" ? (
            <Check className="w-3 h-3" />
          ) : (
            <AlertCircle className="w-3 h-3" />
          )}
          {status.msg}
        </span>
      )}
    </div>
  );
}
