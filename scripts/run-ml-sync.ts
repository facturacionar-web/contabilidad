/**
 * Sync de ML para todos los sellers (AR + CL + MX).
 * Trae órdenes desde el checkpoint o desde 2026-01-01 si es seller nuevo.
 *   npx tsx scripts/run-ml-sync.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { syncOrdenesMl } from "../src/lib/ml/sync-orders";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const userId = process.env.CRON_USER_ID!;
  const maxPorTanda = Number(process.argv[2] ?? "5000");

  console.log(`[ml-sync] maxPorTanda=${maxPorTanda}`);
  const t0 = Date.now();
  const r = await syncOrdenesMl(supabase, userId, { maxPorTanda });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[ml-sync] OK en ${dt}s`);
  console.log(`  Órdenes nuevas: ${r.ordenesNuevas}`);
  console.log(`  Por seller:`);
  for (const [seller, cnt] of Object.entries(r.porSeller)) console.log(`    ${seller}: ${cnt}`);
  if (r.errores.length > 0) {
    console.log(`  Errores (${r.errores.length}):`);
    for (const e of r.errores.slice(0, 10)) console.log(`    - ${e}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
