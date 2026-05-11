/**
 * Retry: sincroniza el detalle solo para periodos específicos pasados por argv.
 *   npx tsx scripts/retry-sii-detalle.ts 202601 202602
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { syncDetalleEmitidos } from "../src/lib/sii/sync-emitidos";

async function main() {
  const periodos = process.argv.slice(2);
  if (periodos.length === 0) {
    console.error("Pasá 1+ periodos YYYYMM");
    process.exit(1);
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Hasta 3 intentos por periodo con espera de 5s entre retries
  let intento = 0;
  let pending = [...periodos];
  while (pending.length > 0 && intento < 3) {
    intento += 1;
    console.log(`\n[retry] Intento ${intento}: ${pending.join(", ")}`);
    const r = await syncDetalleEmitidos(supabase, process.env.CRON_USER_ID!, { periodos: pending });
    console.log(`  ok=${r.periodosSincronizados} upsert=${r.comprobantesUpsert} errores=${r.errores.length}`);
    for (const e of r.errores) console.log(`    - ${e}`);

    // Determinar qué periodos siguen fallando
    const fallados = new Set<string>();
    for (const e of r.errores) {
      const m = e.match(/^(\d{6})/);
      if (m) fallados.add(m[1]);
    }
    pending = [...fallados];
    if (pending.length > 0) await new Promise((r) => setTimeout(r, 5000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
