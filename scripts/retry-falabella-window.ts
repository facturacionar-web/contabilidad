/**
 * Retry de una ventana específica:
 *   npx tsx scripts/retry-falabella-window.ts 2026-01-29 2026-02-05
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { syncFalabellaOrders } from "../src/lib/falabella/sync-orders";

async function main() {
  const desde = process.argv[2];
  const hasta = process.argv[3];
  if (!desde || !hasta) {
    console.error("Uso: tsx retry-falabella-window.ts YYYY-MM-DD YYYY-MM-DD");
    process.exit(1);
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  for (let intento = 1; intento <= 3; intento++) {
    console.log(`\n[retry-${intento}] ${desde} -> ${hasta}`);
    const r = await syncFalabellaOrders(supabase, process.env.CRON_USER_ID!, {
      createdAfter: `${desde}T00:00:00+00:00`,
      createdBefore: `${hasta}T00:00:00+00:00`,
    });
    console.log(`  ordenes=${r.ordenesUpsert} items=${r.itemsUpsert} errs=${r.errores.length}`);
    for (const e of r.errores) console.log(`    - ${e}`);
    if (r.errores.length === 0) break;
    await new Promise((res) => setTimeout(res, 5000));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
