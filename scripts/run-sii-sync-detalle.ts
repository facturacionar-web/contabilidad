/**
 * Sync inicial del detalle (factura por factura) desde 202601 hasta el mes actual.
 * Correr: npx tsx scripts/run-sii-sync-detalle.ts [YYYYMM]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { syncDetalleEmitidos } from "../src/lib/sii/sync-emitidos";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const userId = process.env.CRON_USER_ID!;
  const desde = process.argv[2] ?? "202601";

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`[detalle] Sync desde ${desde} hasta el mes actual...`);
  const t0 = Date.now();
  const r = await syncDetalleEmitidos(supabase, userId, { desde });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n[detalle] OK en ${dt}s`);
  console.log(`  Periodos: ${r.periodosSincronizados}`);
  console.log(`  Comprobantes upsert: ${r.comprobantesUpsert}`);
  console.log(`  Por tipo:`);
  for (const [tipo, cant] of Object.entries(r.porTipo)) {
    console.log(`    ${tipo}: ${cant}`);
  }
  if (r.errores.length > 0) {
    console.log(`  Errores (${r.errores.length}):`);
    for (const e of r.errores.slice(0, 10)) console.log(`    - ${e}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
