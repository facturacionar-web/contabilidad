"use client";
import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import Modal from "./Modal";
import { Upload, FileSpreadsheet, FileText, Loader2, AlertCircle, Check, X } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { Cuenta } from "@/lib/types";

export type ParsedMovimiento = {
  fecha: string;
  descripcion: string;
  monto: number;
  tipo: "debito" | "credito";
  referencia: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  cuenta: Cuenta;
  onConfirm: (movimientos: ParsedMovimiento[]) => Promise<void>;
};

type Step = "upload" | "mapping" | "preview";

const COL_OPTIONS = ["fecha", "descripcion", "monto", "debito", "credito", "referencia", "ignorar"] as const;
type ColOption = typeof COL_OPTIONS[number];

function parseDateAR(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return `${val.getFullYear()}-${String(val.getMonth() + 1).padStart(2, "0")}-${String(val.getDate()).padStart(2, "0")}`;
  }
  const s = String(val).trim();
  // dd/mm/yyyy o dd-mm-yyyy
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m1) {
    const y = m1[3].length === 2 ? `20${m1[3]}` : m1[3];
    return `${y}-${m1[2].padStart(2, "0")}-${m1[1].padStart(2, "0")}`;
  }
  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function parseMonto(val: unknown): number {
  if (val == null || val === "") return 0;
  if (typeof val === "number") return val;
  const s = String(val).trim().replace(/[^\d.,\-]/g, "");
  if (!s) return 0;
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

export default function ConciliacionImportModal({ open, onClose, cuenta, onConfirm }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Para Excel/CSV
  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [excelRows, setExcelRows] = useState<Record<string, unknown>[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, ColOption>>({});

  // Resultado
  const [movimientos, setMovimientos] = useState<ParsedMovimiento[]>([]);
  const [bancoDetectado, setBancoDetectado] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("upload");
    setError(null);
    setExcelHeaders([]);
    setExcelRows([]);
    setColumnMap({});
    setMovimientos([]);
    setBancoDetectado(null);
  }

  async function handleFile(file: File) {
    setError(null);
    setLoading(true);
    try {
      const ext = file.name.toLowerCase().split(".").pop();
      if (ext === "pdf") {
        await parsePdf(file);
      } else if (ext === "xlsx" || ext === "xls" || ext === "csv") {
        await parseExcel(file);
      } else {
        throw new Error("Formato no soportado. Usá .pdf, .xlsx, .xls o .csv");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function parsePdf(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/conciliacion/parse-pdf", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    const movs: ParsedMovimiento[] = (data.movimientos ?? []).map((m: ParsedMovimiento) => ({
      fecha: m.fecha,
      descripcion: m.descripcion,
      monto: Math.abs(Number(m.monto)),
      tipo: m.tipo,
      referencia: m.referencia ?? null,
    }));
    setMovimientos(movs);
    setBancoDetectado(data.banco_detectado ?? null);
    setStep("preview");
  }

  async function parseExcel(file: File) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { raw: false, dateNF: "DD/MM/YYYY" });
    if (rows.length === 0) throw new Error("La planilla no tiene datos");

    const headers = Object.keys(rows[0]);
    setExcelHeaders(headers);
    setExcelRows(rows);

    // Auto-detectar mapping por nombre de columna
    const auto: Record<string, ColOption> = {};
    for (const h of headers) {
      const n = h.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
      if (/fecha|date/.test(n)) auto[h] = "fecha";
      else if (/descrip|concepto|detalle|movimiento/.test(n)) auto[h] = "descripcion";
      else if (/debito|debe|salida|egreso|extracci/.test(n)) auto[h] = "debito";
      else if (/credito|haber|entrada|ingreso|deposit/.test(n)) auto[h] = "credito";
      else if (/monto|importe|total/.test(n)) auto[h] = "monto";
      else if (/ref|operac|comprob|nro|numero/.test(n)) auto[h] = "referencia";
      else auto[h] = "ignorar";
    }
    setColumnMap(auto);
    setStep("mapping");
  }

  function applyMapping() {
    const fechaCol = Object.entries(columnMap).find(([, v]) => v === "fecha")?.[0];
    const descCol = Object.entries(columnMap).find(([, v]) => v === "descripcion")?.[0];
    const montoCol = Object.entries(columnMap).find(([, v]) => v === "monto")?.[0];
    const debCol = Object.entries(columnMap).find(([, v]) => v === "debito")?.[0];
    const credCol = Object.entries(columnMap).find(([, v]) => v === "credito")?.[0];
    const refCol = Object.entries(columnMap).find(([, v]) => v === "referencia")?.[0];

    if (!fechaCol) { setError("Marcá qué columna es la fecha"); return; }
    if (!descCol) { setError("Marcá qué columna es la descripción"); return; }
    if (!montoCol && !debCol && !credCol) { setError("Marcá monto, o débito + crédito"); return; }

    const movs: ParsedMovimiento[] = [];
    for (const row of excelRows) {
      const fecha = parseDateAR(row[fechaCol]);
      if (!fecha) continue;
      const desc = String(row[descCol] ?? "").trim();
      let monto = 0;
      let tipo: "debito" | "credito" = "debito";

      if (debCol || credCol) {
        const deb = debCol ? Math.abs(parseMonto(row[debCol])) : 0;
        const cred = credCol ? Math.abs(parseMonto(row[credCol])) : 0;
        if (deb > 0) { monto = deb; tipo = "debito"; }
        else if (cred > 0) { monto = cred; tipo = "credito"; }
      } else if (montoCol) {
        const m = parseMonto(row[montoCol]);
        monto = Math.abs(m);
        tipo = m < 0 ? "debito" : "credito";
      }

      if (monto <= 0) continue;
      movs.push({
        fecha,
        descripcion: desc,
        monto,
        tipo,
        referencia: refCol ? String(row[refCol] ?? "").trim() || null : null,
      });
    }

    setMovimientos(movs);
    setError(null);
    setStep("preview");
  }

  async function confirmImport() {
    setLoading(true);
    setError(null);
    try {
      await onConfirm(movimientos);
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title={`Importar extracto — ${cuenta.nombre}`}
      size="xl"
    >
      {error && (
        <div className="flex items-start gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {step === "upload" && (
        <div>
          <div
            className="rounded-xl border-2 border-dashed border-slate-200 hover:border-slate-300 p-12 text-center cursor-pointer"
            onClick={() => !loading && inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
          >
            {loading ? (
              <>
                <Loader2 className="w-10 h-10 mx-auto mb-3 text-[var(--primary)] animate-spin" />
                <p className="text-sm text-slate-500">Procesando archivo…</p>
                <p className="text-xs text-slate-400 mt-1">Si es PDF puede tardar 20-40 segundos</p>
              </>
            ) : (
              <>
                <Upload className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p className="text-sm font-medium text-slate-600 mb-1">
                  Arrastrá el extracto o hacé click para seleccionar
                </p>
                <p className="text-xs text-slate-400">.pdf, .xlsx, .xls, .csv — máx. 30 MB</p>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4 text-xs text-slate-500">
            <div className="flex items-start gap-2 p-3 bg-slate-50 rounded-lg">
              <FileText className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-slate-700">PDF</p>
                <p>Cualquier banco. Lo lee Claude AI y extrae los movimientos.</p>
              </div>
            </div>
            <div className="flex items-start gap-2 p-3 bg-slate-50 rounded-lg">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-slate-700">Excel / CSV</p>
                <p>Mapeás qué columna es qué y se importa.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === "mapping" && (
        <div>
          <p className="text-sm text-slate-600 mb-3">
            Indicá qué representa cada columna del archivo:
          </p>
          <div className="border border-[var(--border)] rounded-lg overflow-hidden mb-4">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-[var(--border)]">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">Columna del archivo</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">Representa</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">Ejemplos</th>
                </tr>
              </thead>
              <tbody>
                {excelHeaders.map(h => (
                  <tr key={h} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-2 font-medium text-slate-700">{h}</td>
                    <td className="px-4 py-2">
                      <select
                        value={columnMap[h] ?? "ignorar"}
                        onChange={e => setColumnMap(m => ({ ...m, [h]: e.target.value as ColOption }))}
                        className="select py-1 text-xs w-full"
                      >
                        {COL_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt === "ignorar" ? "— ignorar —" : opt}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-400 truncate max-w-xs">
                      {excelRows.slice(0, 2).map(r => String(r[h] ?? "")).join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between gap-2">
            <button onClick={() => setStep("upload")} className="btn btn-secondary">Atrás</button>
            <button onClick={applyMapping} className="btn btn-primary">Continuar</button>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div>
          {bancoDetectado && (
            <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg mb-3">
              <Check className="w-4 h-4" />
              <span>Banco detectado: <strong>{bancoDetectado}</strong></span>
            </div>
          )}
          <p className="text-sm text-slate-600 mb-3">
            Se detectaron <strong>{movimientos.length}</strong> movimiento{movimientos.length !== 1 ? "s" : ""}.
            Revisalos y confirmá la importación.
          </p>
          <div className="border border-[var(--border)] rounded-lg overflow-hidden mb-4 max-h-[40vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-slate-500">Fecha</th>
                  <th className="text-left px-3 py-2 font-medium text-slate-500">Descripción</th>
                  <th className="text-left px-3 py-2 font-medium text-slate-500">Tipo</th>
                  <th className="text-right px-3 py-2 font-medium text-slate-500">Monto</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m, i) => (
                  <tr key={i} className="border-t border-[var(--border)]">
                    <td className="px-3 py-1.5 whitespace-nowrap text-slate-600">{m.fecha}</td>
                    <td className="px-3 py-1.5 truncate max-w-md text-slate-700">{m.descripcion}</td>
                    <td className="px-3 py-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        m.tipo === "credito" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                      }`}>
                        {m.tipo === "credito" ? "↑ Entró" : "↓ Salió"}
                      </span>
                    </td>
                    <td className={`px-3 py-1.5 text-right font-semibold whitespace-nowrap ${
                      m.tipo === "credito" ? "text-emerald-600" : "text-red-600"
                    }`}>
                      {m.tipo === "credito" ? "+" : "−"} {formatMoney(m.monto, cuenta.moneda, "es-AR")}
                    </td>
                  </tr>
                ))}
                {movimientos.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                      No se detectaron movimientos. Revisá el archivo o el mapeo.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between gap-2">
            <button onClick={() => { reset(); }} className="btn btn-secondary" disabled={loading}>
              Cargar otro
            </button>
            <button
              onClick={confirmImport}
              className="btn btn-primary"
              disabled={loading || movimientos.length === 0}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Importar {movimientos.length} movimiento{movimientos.length !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
