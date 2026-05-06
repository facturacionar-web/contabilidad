"use client";
import { useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import { useTable, insertRow, paisFilter } from "@/lib/useSupabaseData";
import { useConfig } from "@/lib/useConfig";
import { loadConfig } from "@/lib/proveedoresConfig";
import { CURRENCIES, CurrencyCode } from "@/lib/countries";
import { formatMoney, formatDate, todayISO } from "@/lib/format";
import type { GastoEstado, FacturaItem } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileCheck,
} from "lucide-react";

// ── Excel column definitions ───────────────────────────────────────────────
const COLUMNS = [
  { key: "numero_factura", label: "Número Factura", required: true, example: "A-0001-00000123" },
  { key: "proveedor",       label: "Proveedor",       required: true, example: "Mercado Libre SRL" },
  { key: "fecha",           label: "Fecha",           required: true, example: "01/04/2025" },
  { key: "fecha_vencimiento", label: "Fecha Vencimiento", required: true, example: "30/04/2025" },
  { key: "concepto",        label: "Concepto",        required: true, example: "Comisiones" },
  { key: "precio",          label: "Precio",          required: true, example: "10000" },
  { key: "cantidad",        label: "Cantidad",        required: false, example: "1" },
  { key: "iva_pct",         label: "IVA %",           required: false, example: "21" },
  { key: "moneda",          label: "Moneda",          required: false, example: "ARS" },
  { key: "tasa_cambio",     label: "Tipo de cambio",  required: false, example: "1" },
  { key: "notas",           label: "Notas",           required: false, example: "Período marzo 2025" },
] as const;

type ColKey = typeof COLUMNS[number]["key"];

// ── Raw row from Excel ─────────────────────────────────────────────────────
type RawRow = Record<ColKey, string>;

// ── Parsed invoice (grouped) ───────────────────────────────────────────────
type ParsedItem = {
  concepto: string;
  precio: number;
  cantidad: number;
  iva_pct: number;
};

type ParsedFactura = {
  numero_factura: string;
  proveedor_raw: string;
  fecha: string;
  fecha_vencimiento: string;
  moneda: CurrencyCode;
  tasa_cambio: number;
  notas: string;
  items: ParsedItem[];
  // resolved
  contacto_id: number | null;
  contacto_found: boolean;
  concepto_ids: (string | null)[];
  concepto_found: boolean[];
  warnings: string[];
  // computed
  subtotal: number;
  iva_monto: number;
  total: number;
};

// ── helpers ────────────────────────────────────────────────────────────────
function parseDate(val: unknown): string {
  if (!val) return todayISO();
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  // dd/mm/yyyy
  const ddmm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmm) return `${ddmm[3]}-${ddmm[2].padStart(2, "0")}-${ddmm[1].padStart(2, "0")}`;
  // yyyy-mm-dd
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;
  return todayISO();
}

function parseMonto(val: unknown): number {
  if (val == null || val === "") return 0;
  if (typeof val === "number") return val;
  const s = String(val).trim().replace(/[^\d.,\-]/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const dotCount = (s.match(/\./g) || []).length;
  let norm: string;
  if (lastComma > lastDot) {
    norm = s.replace(/\./g, "").replace(",", ".");
  } else if (dotCount > 1) {
    norm = s.replace(/\./g, "");
  } else {
    norm = s.replace(/,/g, "");
  }
  return parseFloat(norm) || 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Main component ─────────────────────────────────────────────────────────
export default function CargaMasivaPage() {
  const { config, country } = useConfig();
  const pais = config?.pais ?? null;

  const { data: contactos } = useTable("contactos", {
    filter: paisFilter(pais),
    skip: !pais,
  });
  const { data: conceptos } = useTable("conceptos", {
    filter: paisFilter(pais),
    skip: !pais,
  });

  const [facturas, setFacturas] = useState<ParsedFactura[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: number; errors: string[] } | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Template download ──────────────────────────────────────────────────
  function downloadTemplate() {
    const headers = COLUMNS.map((c) => c.label);
    const example = COLUMNS.map((c) => c.example);
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    // Column widths
    ws["!cols"] = COLUMNS.map(() => ({ wch: 22 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Facturas");
    XLSX.writeFile(wb, "plantilla_facturas.xlsx");
  }

  // ── Parse uploaded file ────────────────────────────────────────────────
  const parseFile = useCallback(
    (file: File) => {
      setParseError(null);
      setImportResult(null);
      setExpandedRows(new Set());

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target!.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: "array", cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, {
            raw: false,
            dateNF: "DD/MM/YYYY",
          });

          if (raw.length === 0) {
            setParseError("El archivo no contiene filas de datos.");
            setFacturas([]);
            return;
          }

          // Normalize headers
          const normalize = (s: string) =>
            s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "_");

          const headerMap: Partial<Record<string, ColKey>> = {};
          for (const col of COLUMNS) {
            headerMap[normalize(col.label)] = col.key;
          }

          const rows: RawRow[] = raw.map((r) => {
            const out: Partial<RawRow> = {};
            for (const [k, v] of Object.entries(r)) {
              const mapped = headerMap[normalize(k)];
              if (mapped) out[mapped] = String(v ?? "").trim();
            }
            return out as RawRow;
          });

          // Validate required columns present
          const missingCols = COLUMNS.filter(
            (c) => c.required && !rows.some((r) => r[c.key])
          ).map((c) => c.label);
          if (missingCols.length) {
            setParseError(`Columnas obligatorias sin datos: ${missingCols.join(", ")}. ¿Usaste la plantilla correcta?`);
            setFacturas([]);
            return;
          }

          // Default currency: country base currency
          const defaultMoneda = (country?.currency ?? "ARS") as CurrencyCode;
          const defaultIva = country?.ivaDefault ?? 21;

          // Group rows by numero_factura
          const grouped = new Map<string, RawRow[]>();
          for (const row of rows) {
            const num = row.numero_factura?.trim() || `SIN-NUM-${Math.random()}`;
            if (!grouped.has(num)) grouped.set(num, []);
            grouped.get(num)!.push(row);
          }

          // Build ParsedFactura for each group
          const parsed: ParsedFactura[] = [];
          for (const [num, grpRows] of grouped) {
            const first = grpRows[0];
            const monedaRaw = first.moneda?.trim().toUpperCase() as CurrencyCode;
            const moneda: CurrencyCode =
              monedaRaw && monedaRaw in CURRENCIES ? monedaRaw : defaultMoneda;

            const items: ParsedItem[] = grpRows.map((r) => ({
              concepto: r.concepto?.trim() ?? "",
              precio: parseMonto(r.precio),
              cantidad: parseMonto(r.cantidad) || 1,
              iva_pct: parseMonto(r.iva_pct) !== 0 ? parseMonto(r.iva_pct) : defaultIva,
            }));

            // Resolve proveedor
            const proveedorRaw = first.proveedor?.trim() ?? "";
            const contactoMatch = (contactos ?? []).find(
              (c) =>
                c.nombre.toLowerCase() === proveedorRaw.toLowerCase() ||
                c.nombre.toLowerCase().includes(proveedorRaw.toLowerCase())
            );

            // Resolve conceptos
            const conceptoIds: (string | null)[] = items.map((it) => {
              const match = (conceptos ?? []).find(
                (c) =>
                  c.nombre.toLowerCase() === it.concepto.toLowerCase() ||
                  c.nombre.toLowerCase().includes(it.concepto.toLowerCase())
              );
              return match?.id ?? null;
            });

            // Errors / warnings
            const warnings: string[] = [];
            if (!contactoMatch) warnings.push(`Proveedor "${proveedorRaw}" no encontrado`);
            items.forEach((it, i) => {
              if (!conceptoIds[i]) warnings.push(`Concepto "${it.concepto}" no existe en el sistema`);
              if (it.precio <= 0) warnings.push(`Precio 0 en ítem ${i + 1}`);
            });

            // Compute totals
            const subtotal = round2(items.reduce((s, it) => s + it.precio * it.cantidad, 0));
            const iva_monto = round2(
              items.reduce((s, it) => s + (it.precio * it.cantidad * it.iva_pct) / 100, 0)
            );
            const total = round2(subtotal + iva_monto);

            parsed.push({
              numero_factura: num,
              proveedor_raw: proveedorRaw,
              fecha: parseDate(first.fecha),
              fecha_vencimiento: first.fecha_vencimiento ? parseDate(first.fecha_vencimiento) : "",
              moneda,
              tasa_cambio: parseMonto(first.tasa_cambio) || 1,
              notas: first.notas?.trim() ?? "",
              items,
              contacto_id: contactoMatch?.id ?? null,
              contacto_found: !!contactoMatch,
              concepto_ids: conceptoIds,
              concepto_found: conceptoIds.map((id) => id !== null),
              warnings,
              subtotal,
              iva_monto,
              total,
            });
          }

          setFacturas(parsed);
        } catch (err) {
          setParseError(`Error al leer el archivo: ${err instanceof Error ? err.message : String(err)}`);
          setFacturas([]);
        }
      };
      reader.readAsArrayBuffer(file);
    },
    [contactos, conceptos, country]
  );

  // ── Drag & drop ────────────────────────────────────────────────────────
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
    e.target.value = "";
  }

  // ── Import ─────────────────────────────────────────────────────────────
  async function handleImport() {
    if (!pais || !config) return;
    const valid = facturas.filter(isFacturaValida);
    if (valid.length === 0) return;

    setImporting(true);
    let ok = 0;
    const errors: string[] = [];

    for (const f of valid) {
      try {
        const itemsData: FacturaItem[] = f.items.map((it, i) => {
          const nombre = it.concepto;
          const neto = round2(it.precio * it.cantidad);
          const iva_monto = round2((neto * it.iva_pct) / 100);
          return {
            concepto_id: f.concepto_ids[i] ?? null,
            concepto_nombre: nombre,
            precio: it.precio,
            descuento: 0,
            impuesto: it.iva_pct,
            cantidad: it.cantidad,
            observaciones: "",
            neto,
            iva_monto,
            total: round2(neto + iva_monto),
          };
        });

        const firstItem = f.items[0];
        const concepto = firstItem?.concepto || "Factura de proveedor";

        const payload = {
          ctx_pais: pais,
          fecha: f.fecha,
          fecha_vencimiento: f.fecha_vencimiento || null,
          tipo: "factura_proveedor" as const,
          contacto_id: f.contacto_id,
          numero_factura: f.numero_factura,
          concepto,
          categoria: firstItem?.concepto ?? "",
          concepto_id: f.concepto_ids[0] ?? null,
          cuenta_id: null,
          subtotal: f.subtotal,
          iva: firstItem?.iva_pct ?? 0,
          iva_monto: f.iva_monto,
          total: f.total,
          moneda: f.moneda,
          tasa_cambio: f.tasa_cambio,
          estado: "pendiente" as GastoEstado,
          metodo_pago: null,
          monto_pagado: 0,
          notas: f.notas || null,
          items: itemsData,
        };

        const inserted = await insertRow("gastos", payload);
        const facturaId = inserted.id;

        // Build dist_configs
        const distConfigsNew: Record<string, unknown> = {};
        if (f.contacto_id) {
          for (const it of f.items) {
            if (it.concepto) {
              distConfigsNew[it.concepto] = loadConfig(f.contacto_id, it.concepto);
            }
          }
        }

        // Sync en serie con manejo de errores explícito
        try {
          const syncRes = await fetch("/api/sync-factura", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...payload,
              id: facturaId,
              proveedor: f.proveedor_raw,
              tipo_sync: "factura",
              dist_configs: distConfigsNew,
            }),
          });
          const syncData = await syncRes.json().catch(() => ({ ok: false, error: "respuesta no JSON" }));
          if (!syncRes.ok || !syncData.ok) {
            errors.push(
              `Factura ${f.numero_factura}: insertada pero sync al Sheet falló (${syncRes.status}: ${syncData.error ?? "desconocido"})`
            );
          }
        } catch (e) {
          errors.push(
            `Factura ${f.numero_factura}: insertada pero sync al Sheet falló (${e instanceof Error ? e.message : String(e)})`
          );
        }

        ok++;
      } catch (err) {
        errors.push(
          `Factura ${f.numero_factura}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    setImporting(false);
    setImportResult({ ok, errors });
    if (ok > 0) {
      // Remove successfully imported facturas from list
      const imported = new Set(valid.slice(0, ok).map((f) => f.numero_factura));
      setFacturas((prev) => prev.filter((f) => !imported.has(f.numero_factura)));
    }
  }

  // ── Toggle row expand ──────────────────────────────────────────────────
  function toggleRow(num: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
  }

  // ── Stats ──────────────────────────────────────────────────────────────
  // Válida = proveedor encontrado Y todos los conceptos encontrados
  const isFacturaValida = (f: ParsedFactura) =>
    f.contacto_found && f.concepto_found.every(Boolean);
  const validCount = facturas.filter(isFacturaValida).length;
  const errorCount = facturas.filter((f) => !isFacturaValida(f)).length;
  const warnCount = 0; // ya no hay advertencias, solo válida o error

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Carga masiva de facturas"
        description="Importá varias facturas de proveedor a la vez desde un archivo Excel"
      />

      {/* ── Format guide ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-[var(--border)] overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-[var(--primary)]" />
            <span className="font-medium text-sm">Formato del archivo</span>
          </div>
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-2 px-3 py-1.5 bg-[var(--primary)] text-white text-sm font-medium rounded-lg hover:bg-[var(--primary-hover)] transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Descargar plantilla
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-[var(--border)]">
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Columna</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Requerida</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Ejemplo</th>
              </tr>
            </thead>
            <tbody>
              {COLUMNS.map((col) => (
                <tr
                  key={col.key}
                  className="border-b border-[var(--border)] last:border-0 hover:bg-slate-50/50"
                >
                  <td className="px-4 py-2.5 font-medium text-slate-700">{col.label}</td>
                  <td className="px-4 py-2.5">
                    {col.required ? (
                      <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                        Obligatoria
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                        Opcional
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{col.example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 bg-amber-50 border-t border-amber-100 text-xs text-amber-700">
          <strong>Nota:</strong> Podés incluir varias filas con el mismo "Número Factura" para agregar múltiples ítems a la misma factura. El proveedor y los conceptos deben existir previamente en el sistema — usá exactamente el mismo nombre que figura allí.
        </div>
      </div>

      {/* ── Upload zone ───────────────────────────────────────────────── */}
      <div
        className={`rounded-xl border-2 border-dashed transition-colors mb-6 ${
          dragOver
            ? "border-[var(--primary)] bg-[var(--primary-soft)]"
            : "border-slate-200 bg-white hover:border-slate-300"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
          <Upload
            className={`w-10 h-10 mb-3 ${dragOver ? "text-[var(--primary)]" : "text-slate-300"}`}
          />
          <p className="text-sm font-medium text-slate-600 mb-1">
            Arrastrá tu archivo acá o{" "}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-[var(--primary)] hover:underline"
            >
              seleccioná desde el dispositivo
            </button>
          </p>
          <p className="text-xs text-slate-400">.xlsx, .xls o .csv — máx. 10 MB</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={onFileChange}
          />
        </div>
      </div>

      {/* ── Parse error ───────────────────────────────────────────────── */}
      {parseError && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl mb-6 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{parseError}</span>
        </div>
      )}

      {/* ── Import result ─────────────────────────────────────────────── */}
      {importResult && (
        <div
          className={`flex items-start gap-3 p-4 rounded-xl border mb-6 text-sm ${
            importResult.errors.length === 0
              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
              : "bg-amber-50 border-amber-200 text-amber-700"
          }`}
        >
          <FileCheck className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">
              {importResult.ok} factura{importResult.ok !== 1 ? "s" : ""} importada{importResult.ok !== 1 ? "s" : ""} correctamente.
            </p>
            {importResult.errors.length > 0 && (
              <ul className="mt-1 space-y-0.5 list-disc list-inside">
                {importResult.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ── Preview table ─────────────────────────────────────────────── */}
      {facturas.length > 0 && (
        <div className="bg-white rounded-xl border border-[var(--border)] overflow-hidden">
          {/* Header with stats */}
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <span className="font-medium text-sm">
                {facturas.length} factura{facturas.length !== 1 ? "s" : ""} detectadas
              </span>
              <div className="flex items-center gap-3 text-xs">
                {validCount > 0 && (
                  <span className="flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {validCount} listas
                  </span>
                )}
                {errorCount > 0 && (
                  <span className="flex items-center gap-1 text-red-600">
                    <X className="w-3.5 h-3.5" />
                    {errorCount} con errores
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setFacturas([]); setImportResult(null); }}
                className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Limpiar
              </button>
              <button
                onClick={handleImport}
                disabled={importing || validCount === 0}
                className="flex items-center gap-2 px-4 py-1.5 bg-[var(--primary)] text-white text-sm font-medium rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {importing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Importando…
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5" />
                    Importar {validCount} factura{validCount !== 1 ? "s" : ""}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-[var(--border)]">
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500 w-8"></th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">N° Factura</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Proveedor</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Fecha</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Ítems</th>
                  <th className="text-right px-4 py-2.5 font-medium text-slate-500">Total</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-500">Estado</th>
                  <th className="px-2 py-2.5 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {facturas.map((f) => {
                  const expanded = expandedRows.has(f.numero_factura);
                  const isError = !isFacturaValida(f);
                  const hasWarning = false;

                  return (
                    <>
                      <tr
                        key={f.numero_factura}
                        className={`border-b border-[var(--border)] cursor-pointer hover:bg-slate-50/70 transition-colors ${
                          isError ? "bg-red-50/40" : hasWarning ? "bg-amber-50/40" : ""
                        }`}
                        onClick={() => toggleRow(f.numero_factura)}
                      >
                        {/* Status icon */}
                        <td className="px-4 py-3">
                          {isError ? (
                            <X className="w-4 h-4 text-red-500" />
                          ) : hasWarning ? (
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-700 font-mono text-xs">
                          {f.numero_factura}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              f.contacto_found ? "text-slate-700" : "text-red-600 font-medium"
                            }
                          >
                            {f.proveedor_raw}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                          {formatDate(f.fecha)}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {f.items.length} ítem{f.items.length !== 1 ? "s" : ""}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-slate-700 whitespace-nowrap">
                          {formatMoney(f.total, f.moneda)}
                        </td>
                        <td className="px-4 py-3">
                          {isError ? (
                            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                              No importar
                            </span>
                          ) : (
                            <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                              Lista
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-3 text-slate-400">
                          {expanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </td>
                      </tr>

                      {/* Expanded detail */}
                      {expanded && (
                        <tr
                          key={`${f.numero_factura}-detail`}
                          className="border-b border-[var(--border)] bg-slate-50/50"
                        >
                          <td colSpan={8} className="px-6 py-4">
                            {/* Warnings */}
                            {f.warnings.length > 0 && (
                              <div className="mb-3 flex flex-wrap gap-1.5">
                                {f.warnings.map((w, i) => (
                                  <span
                                    key={i}
                                    className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full"
                                  >
                                    <AlertTriangle className="w-3 h-3" />
                                    {w}
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Items table */}
                            <table className="w-full text-xs border border-[var(--border)] rounded-lg overflow-hidden">
                              <thead>
                                <tr className="bg-slate-100">
                                  <th className="text-left px-3 py-2 font-medium text-slate-500">Concepto</th>
                                  <th className="text-right px-3 py-2 font-medium text-slate-500">Precio</th>
                                  <th className="text-right px-3 py-2 font-medium text-slate-500">Cant.</th>
                                  <th className="text-right px-3 py-2 font-medium text-slate-500">IVA %</th>
                                  <th className="text-right px-3 py-2 font-medium text-slate-500">Total ítem</th>
                                  <th className="text-left px-3 py-2 font-medium text-slate-500">Concepto ID</th>
                                </tr>
                              </thead>
                              <tbody>
                                {f.items.map((it, i) => {
                                  const itemTotal = round2(
                                    it.precio * it.cantidad * (1 + it.iva_pct / 100)
                                  );
                                  return (
                                    <tr
                                      key={i}
                                      className="border-t border-[var(--border)] last:border-0"
                                    >
                                      <td className={`px-3 py-2 ${!f.concepto_found[i] ? "text-amber-600 font-medium" : "text-slate-700"}`}>
                                        {it.concepto || <em className="text-slate-400">Sin concepto</em>}
                                      </td>
                                      <td className="px-3 py-2 text-right text-slate-600">
                                        {formatMoney(it.precio, f.moneda)}
                                      </td>
                                      <td className="px-3 py-2 text-right text-slate-600">{it.cantidad}</td>
                                      <td className="px-3 py-2 text-right text-slate-600">{it.iva_pct}%</td>
                                      <td className="px-3 py-2 text-right font-medium text-slate-700">
                                        {formatMoney(itemTotal, f.moneda)}
                                      </td>
                                      <td className="px-3 py-2 font-mono text-slate-400">
                                        {f.concepto_ids[i] ? (
                                          <span className="text-emerald-600">✓ encontrado</span>
                                        ) : (
                                          <span className="text-amber-500">⚠ no encontrado</span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                              <tfoot className="bg-slate-50 border-t border-[var(--border)]">
                                <tr>
                                  <td colSpan={4} className="px-3 py-2 text-right text-slate-500">
                                    Subtotal / IVA / Total
                                  </td>
                                  <td className="px-3 py-2 text-right font-semibold text-slate-700">
                                    {formatMoney(f.subtotal, f.moneda)} /{" "}
                                    {formatMoney(f.iva_monto, f.moneda)} /{" "}
                                    {formatMoney(f.total, f.moneda)}
                                  </td>
                                  <td />
                                </tr>
                              </tfoot>
                            </table>

                            {/* Extra info */}
                            <div className="mt-2 flex gap-4 text-xs text-slate-500">
                              <span>
                                <strong>Moneda:</strong> {f.moneda}
                                {f.tasa_cambio !== 1 && ` (TC: ${f.tasa_cambio})`}
                              </span>
                              {f.fecha_vencimiento && (
                                <span>
                                  <strong>Vencimiento:</strong> {formatDate(f.fecha_vencimiento)}
                                </span>
                              )}
                              {f.notas && (
                                <span>
                                  <strong>Notas:</strong> {f.notas}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
