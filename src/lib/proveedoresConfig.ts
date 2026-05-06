import { createClient } from "@/lib/supabase/client";

// ── Tipos ────────────────────────────────────────────────────────────────────

export const PAISES = ["ARG", "MEX", "CHILE"] as const;
export type PaisKey = "ARG" | "MEX" | "CHILE";

export const CUENTAS = [
  { key: "dropshipping",       label: "DropShipping" },
  { key: "importado_stock",    label: "Importado Stock" },
  { key: "importado_nacional", label: "Importado Nacional" },
] as const;
export type CuentaKey = "dropshipping" | "importado_stock" | "importado_nacional";

export type DistCuentas = Record<CuentaKey, number>;

export type ConceptoConfig = {
  operativo: boolean;
  incluir: boolean;
  dist_pais: Record<PaisKey, number>;
  dist_cuentas: Record<PaisKey, DistCuentas>;
  prorrateo: Record<PaisKey, boolean>;
};

// ── Defaults ─────────────────────────────────────────────────────────────────

export function defaultDistCuentas(): DistCuentas {
  return { dropshipping: 0, importado_stock: 0, importado_nacional: 0 };
}

export function defaultConfig(): ConceptoConfig {
  return {
    operativo: true,
    incluir: true,
    dist_pais: { ARG: 0, MEX: 0, CHILE: 0 },
    dist_cuentas: { ARG: defaultDistCuentas(), MEX: defaultDistCuentas(), CHILE: defaultDistCuentas() },
    prorrateo: { ARG: false, MEX: false, CHILE: false },
  };
}

// ── Template global por proveedor+concepto ────────────────────────────────────

export function lsKey(contactoId: number, concepto: string): string {
  return `concepto_cfg:${contactoId}:${concepto}`;
}

export function hasConfig(contactoId: number, concepto: string): boolean {
  return typeof window !== "undefined" && localStorage.getItem(lsKey(contactoId, concepto)) !== null;
}

export function loadConfig(contactoId: number, concepto: string): ConceptoConfig {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(lsKey(contactoId, concepto)) : null;
    if (!raw) return defaultConfig();
    const p = JSON.parse(raw);
    return {
      ...defaultConfig(), ...p,
      dist_pais: { ...defaultConfig().dist_pais, ...p.dist_pais },
      dist_cuentas: {
        ARG:   { ...defaultDistCuentas(), ...p.dist_cuentas?.ARG },
        MEX:   { ...defaultDistCuentas(), ...p.dist_cuentas?.MEX },
        CHILE: { ...defaultDistCuentas(), ...p.dist_cuentas?.CHILE },
      },
      prorrateo: { ...defaultConfig().prorrateo, ...p.prorrateo },
    };
  } catch { return defaultConfig(); }
}

export function saveConfig(contactoId: number, concepto: string, cfg: ConceptoConfig): void {
  localStorage.setItem(lsKey(contactoId, concepto), JSON.stringify(cfg));
  // Push a Supabase en background (fire-and-forget)
  void pushConfigToCloud(contactoId, concepto, cfg);
}

/** Persiste la config en Supabase. No bloquea — ignora errores. */
async function pushConfigToCloud(contactoId: number, concepto: string, cfg: ConceptoConfig): Promise<void> {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    const owner = (user.user_metadata?.owner_id as string | undefined) ?? user.id;
    // Detectar país activo desde config para llenar ctx_pais
    const { data: cfgRows } = await sb.from("config").select("pais,is_active").eq("user_id", owner);
    const ctxPais = (cfgRows ?? []).find((c: { is_active: boolean }) => c.is_active)?.pais
      ?? (cfgRows ?? [])[0]?.pais
      ?? "AR";
    await sb.from("proveedor_config").upsert({
      user_id: owner,
      ctx_pais: ctxPais,
      contacto_id: contactoId,
      concepto_nombre: concepto,
      config: cfg,
      updated_at: new Date().toISOString(),
    } as never, { onConflict: "user_id,contacto_id,concepto_nombre" });
  } catch (e) {
    console.warn("[proveedoresConfig] cloud push failed:", e);
  }
}

/** Hidrata localStorage con todas las configs/snapshots desde Supabase. Llamar al login. */
export async function hydrateProveedoresFromCloud(): Promise<{ configs: number; snapshots: number }> {
  if (typeof window === "undefined") return { configs: 0, snapshots: 0 };
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return { configs: 0, snapshots: 0 };

    const [pcRes, psRes] = await Promise.all([
      sb.from("proveedor_config").select("contacto_id,concepto_nombre,config"),
      sb.from("pago_snapshot").select("pago_id,contacto_id,conceptos,saved_at"),
    ]);
    const pc = (pcRes.data ?? []) as { contacto_id: number; concepto_nombre: string; config: ConceptoConfig }[];
    const ps = (psRes.data ?? []) as { pago_id: number; contacto_id: number; conceptos: Record<string, ConceptoConfig>; saved_at: string }[];

    for (const r of pc) {
      localStorage.setItem(lsKey(r.contacto_id, r.concepto_nombre), JSON.stringify(r.config));
    }
    for (const r of ps) {
      const snap: PaymentSnapshot = {
        contactoId: r.contacto_id,
        conceptos: r.conceptos,
        savedAt: new Date(r.saved_at).getTime(),
      };
      localStorage.setItem(snapKey(r.pago_id), JSON.stringify(snap));
    }
    return { configs: pc.length, snapshots: ps.length };
  } catch (e) {
    console.warn("[proveedoresConfig] hydrate failed:", e);
    return { configs: 0, snapshots: 0 };
  }
}

/** Migra todo lo que esté en localStorage a Supabase (one-shot). */
export async function migrateProveedoresToCloud(): Promise<{ configs: number; snapshots: number }> {
  if (typeof window === "undefined") return { configs: 0, snapshots: 0 };
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return { configs: 0, snapshots: 0 };
    const owner = (user.user_metadata?.owner_id as string | undefined) ?? user.id;
    const { data: cfgRows } = await sb.from("config").select("pais,is_active").eq("user_id", owner);
    const ctxPais = (cfgRows ?? []).find((c: { is_active: boolean }) => c.is_active)?.pais
      ?? (cfgRows ?? [])[0]?.pais ?? "AR";

    let configs = 0;
    let snapshots = 0;
    const cfgsToInsert: Record<string, unknown>[] = [];
    const snapsToInsert: Record<string, unknown>[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith("concepto_cfg:")) {
        const parts = k.split(":");
        const contactoId = Number(parts[1]);
        const concepto = parts.slice(2).join(":");
        try {
          const cfg = JSON.parse(localStorage.getItem(k) ?? "{}");
          cfgsToInsert.push({
            user_id: owner,
            ctx_pais: ctxPais,
            contacto_id: contactoId,
            concepto_nombre: concepto,
            config: cfg,
            updated_at: new Date().toISOString(),
          });
        } catch { /* skip */ }
      } else if (k.startsWith("pago_snap:")) {
        const pagoId = Number(k.replace("pago_snap:", ""));
        try {
          const snap = JSON.parse(localStorage.getItem(k) ?? "{}");
          if (snap?.contactoId && snap?.conceptos) {
            snapsToInsert.push({
              user_id: owner,
              ctx_pais: ctxPais,
              pago_id: pagoId,
              contacto_id: snap.contactoId,
              conceptos: snap.conceptos,
              saved_at: new Date(snap.savedAt ?? Date.now()).toISOString(),
            });
          }
        } catch { /* skip */ }
      }
    }

    if (cfgsToInsert.length > 0) {
      const { error } = await sb.from("proveedor_config").upsert(cfgsToInsert as never, {
        onConflict: "user_id,contacto_id,concepto_nombre",
      });
      if (!error) configs = cfgsToInsert.length;
    }
    if (snapsToInsert.length > 0) {
      const { error } = await sb.from("pago_snapshot").upsert(snapsToInsert as never, {
        onConflict: "user_id,pago_id",
      });
      if (!error) snapshots = snapsToInsert.length;
    }
    return { configs, snapshots };
  } catch (e) {
    console.warn("[proveedoresConfig] migrate failed:", e);
    return { configs: 0, snapshots: 0 };
  }
}

// ── Snapshot por pago (inmutable históricamente) ──────────────────────────────
//
// Cada pago/factura guarda una copia del config vigente al momento de guardarlo.
// Si el template global cambia después, estos pagos no se ven afectados.

type PaymentSnapshot = {
  contactoId: number;
  /** concepto_nombre → config vigente al momento del pago */
  conceptos: Record<string, ConceptoConfig>;
  savedAt: number; // timestamp
};

export function snapKey(pagoId: number): string {
  return `pago_snap:${pagoId}`;
}

export function hasSnapshot(pagoId: number): boolean {
  return typeof window !== "undefined" && localStorage.getItem(snapKey(pagoId)) !== null;
}

export function loadSnapshot(pagoId: number): PaymentSnapshot | null {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(snapKey(pagoId)) : null;
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveSnapshot(pagoId: number, contactoId: number, conceptos: Record<string, ConceptoConfig>): void {
  if (typeof window === "undefined") return;
  const snap: PaymentSnapshot = { contactoId, conceptos, savedAt: Date.now() };
  localStorage.setItem(snapKey(pagoId), JSON.stringify(snap));
  // Push a Supabase en background
  void pushSnapshotToCloud(pagoId, contactoId, conceptos);
}

/** Persiste el snapshot del pago en Supabase. No bloquea — ignora errores. */
async function pushSnapshotToCloud(pagoId: number, contactoId: number, conceptos: Record<string, ConceptoConfig>): Promise<void> {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    const owner = (user.user_metadata?.owner_id as string | undefined) ?? user.id;
    const { data: cfgRows } = await sb.from("config").select("pais,is_active").eq("user_id", owner);
    const ctxPais = (cfgRows ?? []).find((c: { is_active: boolean }) => c.is_active)?.pais
      ?? (cfgRows ?? [])[0]?.pais ?? "AR";
    await sb.from("pago_snapshot").upsert({
      user_id: owner,
      ctx_pais: ctxPais,
      pago_id: pagoId,
      contacto_id: contactoId,
      conceptos,
      saved_at: new Date().toISOString(),
    } as never, { onConflict: "user_id,pago_id" });
  } catch (e) {
    console.warn("[proveedoresConfig] cloud snapshot push failed:", e);
  }
}

/**
 * Dado un pago y un nombre de concepto, devuelve la config efectiva:
 * → snapshot del pago si existe
 * → template global si no
 * → defaultConfig() si ninguno
 */
export function effectiveConfig(pagoId: number, contactoId: number, concepto: string): ConceptoConfig {
  const snap = loadSnapshot(pagoId);
  if (snap?.conceptos[concepto]) return snap.conceptos[concepto];
  if (hasConfig(contactoId, concepto)) return loadConfig(contactoId, concepto);
  return defaultConfig();
}

/**
 * Toma snapshot del config actual para todos los conceptos de un pago.
 * Solo guarda conceptos que ya tienen template configurado.
 * Retorna los nombres de conceptos sin config (para mostrar aviso).
 */
export function snapshotPayment(
  pagoId: number,
  contactoId: number,
  conceptoNombres: string[]
): string[] {
  if (typeof window === "undefined" || !pagoId || !contactoId) return [];
  const configured: Record<string, ConceptoConfig> = {};
  const missing: string[] = [];
  for (const nombre of conceptoNombres) {
    if (hasConfig(contactoId, nombre)) {
      configured[nombre] = loadConfig(contactoId, nombre);
    } else {
      missing.push(nombre);
    }
  }
  if (Object.keys(configured).length > 0) {
    saveSnapshot(pagoId, contactoId, configured);
  }
  return missing;
}

/**
 * Aplica el template actual a todos los pagos dados (para retroactivo opcional).
 */
export function applyTemplateToPayments(
  contactoId: number,
  concepto: string,
  cfg: ConceptoConfig,
  pagoIds: number[]
): void {
  for (const id of pagoIds) {
    const existing = loadSnapshot(id);
    const merged: Record<string, ConceptoConfig> = { ...(existing?.conceptos ?? {}), [concepto]: cfg };
    saveSnapshot(id, contactoId, merged);
  }
}
