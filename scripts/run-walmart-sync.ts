/**
 * Sync inicial Walmart desde fecha hasta hoy.
 *   npx tsx scripts/run-walmart-sync.ts 2026-01-01
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { syncWalmartOrders } from "../src/lib/walmart/sync-orders";

async function main() {
  const desde = process.argv[2] ?? "2026-01-01";
  const createdStart = `${desde}T00:00:00Z`;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  console.log(`[sync] Walmart desde ${createdStart}`);
  const t0 = Date.now();
  const r = await syncWalmartOrders(supabase, process.env.CRON_USER_ID!, { createdStart });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n[sync] OK en ${dt}s`);
  console.log(`  Ordenes: ${r.ordenesUpsert}`);
  console.log(`  Lines:   ${r.linesUpsert}`);
  if (r.errores.length) {
    console.log(`  Errores (${r.errores.length}):`);
    for (const e of r.errores.slice(0, 10)) console.log(`    - ${e}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
