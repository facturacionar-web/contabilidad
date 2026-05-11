/**
 * Sync inicial Falabella desde una fecha hasta hoy.
 *   npx tsx scripts/run-falabella-sync.ts 2026-01-01
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { syncFalabellaOrders } from "../src/lib/falabella/sync-orders";

async function main() {
  const desde = process.argv[2] ?? "2026-01-01";
  const createdAfter = `${desde}T00:00:00+00:00`;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  console.log(`[sync] Falabella desde ${createdAfter}`);
  const t0 = Date.now();
  const r = await syncFalabellaOrders(supabase, process.env.CRON_USER_ID!, { createdAfter });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n[sync] OK en ${dt}s`);
  console.log(`  Órdenes upsert: ${r.ordenesUpsert}`);
  console.log(`  Items upsert:   ${r.itemsUpsert}`);
  if (r.errores.length > 0) {
    console.log(`  Errores (${r.errores.length}):`);
    for (const e of r.errores.slice(0, 10)) console.log(`    - ${e}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
