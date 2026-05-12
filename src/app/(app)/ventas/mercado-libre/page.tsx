"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { Loader2, AlertTriangle, Info, ExternalLink } from "lucide-react";
import { useConfig } from "@/lib/useConfig";

type Seller = { ml_user_id: number; nickname: string | null; site_id: string | null };
type MesRow = { mes: string; cantidad: number; cant_pagadas: number; cant_canceladas: number; total_bruto: number; total_neto: number };

// Mapeo país app → ML site_id + vista + currency + label
const COUNTRY_TO_ML = {
  CL: { siteId: "MLC", view: "ml_cl_resumen_mensual_v", currency: "CLP" as const, locale: "es-CL", label: "Chile" },
  MX: { siteId: "MLM", view: "ml_mx_resumen_mensual_v", currency: "MXN" as const, locale: "es-MX", label: "México" },
} as const;

function nombreMes(yyyymm: string, locale: string): string {
  const [y, m] = yyyymm.split("-");
  const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  void locale;
  return `${meses[Number(m) - 1] ?? m} ${y}`;
}

export default function VentasMercadoLibrePage() {
  const { config } = useConfig();
  const pais = config?.pais as "CL" | "MX" | undefined;
  const cfg = pais && pais in COUNTRY_TO_ML ? COUNTRY_TO_ML[pais as "CL" | "MX"] : null;

  const [sellers, setSellers] = useState<Seller[]>([]);
  const [rows, setRows] = useState<MesRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!cfg) { setLoading(false); return; }
    const supabase = createClient();
    const [sRes, rRes] = await Promise.all([
      supabase.from("ml_oauth_cache").select("ml_user_id, nickname, site_id").eq("site_id", cfg.siteId),
      supabase.from(cfg.view).select("mes, cantidad, cant_pagadas, cant_canceladas, total_bruto, total_neto").order("mes", { ascending: false }),
    ]);
    if (sRes.error) setError(sRes.error.message);
    if (rRes.error) setError((prev) => prev ?? rRes.error!.message);
    setSellers((sRes.data ?? []) as Seller[]);
    setRows((rRes.data ?? []).map((r) => ({
      mes: String(r.mes),
      cantidad: Number(r.cantidad ?? 0),
      cant_pagadas: Number(r.cant_pagadas ?? 0),
      cant_canceladas: Number(r.cant_canceladas ?? 0),
      total_bruto: Number(r.total_bruto ?? 0),
      total_neto: Number(r.total_neto ?? 0),
    })) as MesRow[]);
    setLoading(false);
  }, [cfg]);

  useEffect(() => { load(); }, [load]);

  if (!cfg) {
    return (
      <div>
        <PageHeader title="Mercado Libre — Ventas" />
        <div className="rounded-lg border border-[var(--border)] p-8 text-center text-[var(--muted)]">
          Esta página solo está disponible cuando el país activo es Chile o México.
        </div>
      </div>
    );
  }

  const sinConectar = !loading && sellers.length === 0;
  const sinDatos = !loading && sellers.length > 0 && (rows?.length ?? 0) === 0;
  const totales = rows ? rows.reduce(
    (acc, r) => ({ cantidad: acc.cantidad + r.cantidad, total_neto: acc.total_neto + r.total_neto }),
    { cantidad: 0, total_neto: 0 },
  ) : null;

  return (
    <div>
      <PageHeader
        title={`Mercado Libre ${cfg.label} — Ventas`}
        description={`Órdenes sincronizadas desde tu cuenta de Mercado Libre ${cfg.label}.`}
        action={
          sinConectar ? null : (
            <a href={`/api/ml/oauth/start?country=${pais}`} className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white hover:bg-slate-50">
              <ExternalLink className="w-4 h-4" /> Reautorizar
            </a>
          )
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 mb-4 flex items-start gap-2 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 mt-0.5" /> {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-[var(--muted)]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando…
        </div>
      )}

      {sinConectar && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900 flex items-start gap-3">
          <Info className="w-5 h-5 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium mb-1">Conectá tu cuenta de Mercado Libre {cfg.label}</div>
            <p className="text-sm mb-3">
              Click en el botón para autorizar la app. Te redirige al login de Mercado Libre {cfg.label}.
            </p>
            <a href={`/api/ml/oauth/start?country=${pais}`} className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]">
              <ExternalLink className="w-4 h-4" /> Conectar Mercado Libre {cfg.label}
            </a>
          </div>
        </div>
      )}

      {sellers.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--accent)]/40 p-3 mb-4 flex items-center gap-2 text-sm text-slate-700">
          <Info className="w-4 h-4 shrink-0 text-[var(--primary)]" />
          Conectados:{" "}
          {sellers.map((s) => (
            <span key={s.ml_user_id} className="inline-block px-2 py-0.5 bg-white rounded border border-[var(--border)] mr-1">
              {s.nickname ?? `Seller ${s.ml_user_id}`}
            </span>
          ))}
        </div>
      )}

      {sinDatos && (
        <div className="rounded-lg border border-[var(--border)] p-8 text-center text-[var(--muted)]">
          Cuenta conectada pero todavía no se sincronizaron órdenes. El sync diario va a traerlas automáticamente.
        </div>
      )}

      {rows && rows.length > 0 && totales && (
        <div className="rounded-lg border border-[var(--border)] bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left font-medium px-4 py-2">Mes</th>
                <th className="text-right font-medium px-4 py-2">Cant.</th>
                <th className="text-right font-medium px-4 py-2">Pagadas</th>
                <th className="text-right font-medium px-4 py-2">Canceladas</th>
                <th className="text-right font-medium px-4 py-2">Bruto</th>
                <th className="text-right font-medium px-4 py-2 bg-[var(--primary-soft)]">Total neto</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.mes} className="border-t border-[var(--border)] hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium">{nombreMes(r.mes, cfg.locale)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.cantidad}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{r.cant_pagadas}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-red-600">{r.cant_canceladas || "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(r.total_bruto, cfg.currency, cfg.locale)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold bg-[var(--primary-soft)]/40">{formatMoney(r.total_neto, cfg.currency, cfg.locale)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold border-t-2 border-[var(--border)]">
              <tr>
                <td className="px-4 py-2">Total</td>
                <td className="px-4 py-2 text-right tabular-nums">{totales.cantidad}</td>
                <td className="px-4 py-2"></td>
                <td className="px-4 py-2"></td>
                <td className="px-4 py-2"></td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(totales.total_neto, cfg.currency, cfg.locale)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
