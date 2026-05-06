"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ImportarContactosPage() {
  const router = useRouter();
  const [estado, setEstado] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [resultado, setResultado] = useState<{ insertados: number; omitidos: number; pais: string; detalle?: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function importar() {
    setEstado("loading");
    setError(null);
    try {
      const res = await fetch("/api/import-contactos", { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Error desconocido");
        setEstado("error");
      } else {
        setResultado(data);
        setEstado("done");
      }
    } catch (e) {
      setError((e as Error).message);
      setEstado("error");
    }
  }

  return (
    <div className="max-w-xl mx-auto mt-16 p-8 bg-white rounded-xl border border-slate-200 shadow-sm space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">Importar contactos</h1>
        <p className="text-sm text-slate-500">Carga masiva de 26 proveedores. Se omitirán los que ya existan (por CUIT).</p>
      </div>

      {estado === "idle" && (
        <button className="btn btn-primary w-full" onClick={importar}>
          Importar 26 contactos
        </button>
      )}

      {estado === "loading" && (
        <div className="text-center text-sm text-slate-500 py-4">
          <div className="inline-block w-6 h-6 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin mb-2" />
          <p>Importando…</p>
        </div>
      )}

      {estado === "done" && resultado && (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm">
            <p className="font-semibold text-green-800 mb-1">¡Listo!</p>
            <p className="text-green-700">✓ {resultado.insertados} contacto{resultado.insertados !== 1 ? "s" : ""} importado{resultado.insertados !== 1 ? "s" : ""} en {resultado.pais}</p>
            {resultado.omitidos > 0 && <p className="text-green-600">{resultado.omitidos} ya existían (omitidos)</p>}
          </div>
          {resultado.detalle && resultado.detalle.length > 0 && (
            <ul className="text-xs text-slate-600 space-y-0.5 max-h-60 overflow-y-auto border rounded-lg p-3 bg-slate-50">
              {resultado.detalle.map((n, i) => <li key={i}>✓ {n}</li>)}
            </ul>
          )}
          <button className="btn btn-primary w-full" onClick={() => router.push("/contactos")}>
            Ir a Contactos
          </button>
        </div>
      )}

      {estado === "error" && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 space-y-3">
          <p><strong>Error:</strong> {error}</p>
          <button className="btn btn-secondary w-full" onClick={() => setEstado("idle")}>
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}
