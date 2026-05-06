import type { Gasto, Ingreso, Contacto } from "./types";

export type Candidate = {
  type: "pago" | "ingreso";
  id: number;
  fecha: string;
  monto: number;
  proveedor_nombre?: string;
  concepto?: string;
  numero_factura?: string | null;
};

export type ScoredCandidate = {
  candidate: Candidate;
  score: number;
  details: { monto: number; fecha: number; descripcion: number };
};

/** Distancia en días entre dos fechas ISO YYYY-MM-DD */
function daysDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = new Date(ay, am - 1, ad).getTime();
  const db = new Date(by, bm - 1, bd).getTime();
  return Math.abs(da - db) / (1000 * 60 * 60 * 24);
}

/** Normaliza texto para comparación: minúscula sin acentos */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Calcula score de match entre un movimiento del banco y un candidato (pago/ingreso) */
export function scoreMatch(
  movimiento: { fecha: string; monto: number; descripcion: string | null; tipo: "debito" | "credito" },
  candidate: Candidate,
): ScoredCandidate {
  const desc = norm(movimiento.descripcion ?? "");
  const movMontoAbs = Math.abs(Number(movimiento.monto));
  const candMontoAbs = Math.abs(Number(candidate.monto));
  const result: ScoredCandidate = {
    candidate,
    score: 0,
    details: { monto: 0, fecha: 0, descripcion: 0 },
  };

  // ── Monto (max 50 pts) ─────────────────────────────────────
  const diff = Math.abs(movMontoAbs - candMontoAbs);
  const pctDiff = movMontoAbs > 0 ? diff / movMontoAbs : 1;
  if (diff < 0.01) {
    result.details.monto = 50;
  } else if (pctDiff < 0.005) {
    result.details.monto = 45;
  } else if (pctDiff < 0.02) {
    result.details.monto = 30;
  } else if (pctDiff < 0.05) {
    result.details.monto = 15;
  } else {
    return result; // diferencia > 5% → descartar
  }

  // ── Fecha (max 30 pts) ─────────────────────────────────────
  const dd = daysDiff(movimiento.fecha, candidate.fecha);
  if (dd === 0) result.details.fecha = 30;
  else if (dd <= 1) result.details.fecha = 25;
  else if (dd <= 3) result.details.fecha = 18;
  else if (dd <= 7) result.details.fecha = 8;
  else if (dd <= 15) result.details.fecha = 2;

  // ── Descripción (max 20 pts) ───────────────────────────────
  if (desc) {
    if (candidate.proveedor_nombre) {
      const prov = norm(candidate.proveedor_nombre);
      // Probamos coincidencia de cualquier palabra significativa (≥4 letras)
      const palabrasProv = prov.split(" ").filter(p => p.length >= 4);
      let provHit = 0;
      for (const p of palabrasProv) {
        if (desc.includes(p)) provHit++;
      }
      if (provHit > 0 && palabrasProv.length > 0) {
        result.details.descripcion += Math.min(15, Math.round((provHit / palabrasProv.length) * 15));
      }
    }
    if (candidate.numero_factura) {
      const num = norm(candidate.numero_factura);
      if (num.length >= 3 && desc.includes(num)) {
        result.details.descripcion += 10;
      }
    }
    if (candidate.concepto) {
      const conc = norm(candidate.concepto);
      const palabras = conc.split(" ").filter(p => p.length >= 4);
      for (const p of palabras) {
        if (desc.includes(p)) {
          result.details.descripcion += 3;
          break;
        }
      }
    }
    result.details.descripcion = Math.min(20, result.details.descripcion);
  }

  result.score = result.details.monto + result.details.fecha + result.details.descripcion;
  return result;
}

/** Encuentra los mejores N candidatos ordenados por score descendente */
export function findBestMatches(
  movimiento: { fecha: string; monto: number; descripcion: string | null; tipo: "debito" | "credito"; cuenta_id: string | null },
  pagos: Gasto[],
  ingresos: Ingreso[],
  contactos: Contacto[],
  matchedIds: { pagos: Set<number>; ingresos: Set<number> },
  limit = 5,
): ScoredCandidate[] {
  const contactoMap = new Map<number, string>();
  for (const c of contactos) contactoMap.set(c.id, c.nombre);

  const candidates: Candidate[] = [];

  // Egreso de banco → pagos
  if (movimiento.tipo === "debito") {
    for (const p of pagos) {
      if (matchedIds.pagos.has(p.id)) continue;
      // Si el movimiento tiene cuenta y el pago tiene cuenta distinta, descartar
      if (movimiento.cuenta_id && p.cuenta_id && p.cuenta_id !== movimiento.cuenta_id) continue;
      candidates.push({
        type: "pago",
        id: p.id,
        fecha: p.fecha,
        monto: Number(p.total),
        proveedor_nombre: p.contacto_id ? contactoMap.get(p.contacto_id) : undefined,
        concepto: p.concepto,
        numero_factura: p.numero_factura,
      });
    }
  } else {
    // Crédito al banco → ingresos
    for (const i of ingresos) {
      if (matchedIds.ingresos.has(i.id)) continue;
      if (movimiento.cuenta_id && i.cuenta_id && i.cuenta_id !== movimiento.cuenta_id) continue;
      candidates.push({
        type: "ingreso",
        id: i.id,
        fecha: i.fecha,
        monto: Number(i.monto),
        proveedor_nombre: i.contacto_id ? contactoMap.get(i.contacto_id) : undefined,
        concepto: i.concepto,
      });
    }
  }

  const scored = candidates
    .map(c => scoreMatch(movimiento, c))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

/**
 * Categoría del score:
 *  >= 75 → "auto" (match seguro)
 *  >= 50 → "candidato" (mostrar para confirmar)
 *  < 50 → "débil"
 */
export function scoreCategory(score: number): "auto" | "candidato" | "debil" {
  if (score >= 75) return "auto";
  if (score >= 50) return "candidato";
  return "debil";
}
