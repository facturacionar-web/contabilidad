/**
 * Ejecuta el sync SII directo (sin pasar por HTTP), usando el cliente admin
 * de Supabase y la lib lib/sii/.
 *
 * Requiere las env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * CRON_USER_ID, SII_AMBIENTE, SII_RUT_EMPRESA, SII_CERT_PEM, SII_KEY_PEM.
 *
 * Correr:
 *   npx tsx scripts/run-sii-sync.ts [meses]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { syncResumenEmitidos } from "../src/lib/sii/sync-emitidos";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.CRON_USER_ID;
  if (!url || !serviceKey || !userId) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o CRON_USER_ID");
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const meses = Number(process.argv[2] ?? "24");
  console.log(`[run-sync] Sincronizando últimos ${meses} meses para user ${userId.slice(0, 8)}...`);

  const { data: run } = await supabase
    .from("sii_sync_runs")
    .insert({ user_id: userId, status: "running" })
    .select("id")
    .single();

  try {
    const result = await syncResumenEmitidos(supabase, userId, { meses });

    const status = result.errores.length > 0 && result.periodosSincronizados === 0 ? "error" : "ok";
    await supabase
      .from("sii_sync_runs")
      .update({
        status,
        finished_at: new Date().toISOString(),
        periodos_sincronizados: result.periodosSincronizados,
        filas_actualizadas: result.filasActualizadas,
        error_mensaje: result.errores.length > 0 ? result.errores.join(" | ") : null,
        raw: result as unknown as object,
      })
      .eq("id", run?.id);

    console.log(`\n[run-sync] OK`);
    console.log(`  Periodos sincronizados: ${result.periodosSincronizados}`);
    console.log(`  Filas actualizadas:     ${result.filasActualizadas}`);
    if (result.errores.length > 0) {
      console.log(`  Errores (${result.errores.length}):`);
      for (const e of result.errores) console.log(`    - ${e}`);
    }
    console.log(`\nDetalle por periodo:`);
    for (const [periodo, info] of Object.entries(result.detallePorPeriodo)) {
      console.log(`  ${periodo}: ${info.items} tipos, ${info.totalDocs} documentos`);
    }
  } catch (err) {
    await supabase
      .from("sii_sync_runs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error_mensaje: String(err),
      })
      .eq("id", run?.id);
    throw err;
  }
}

main().catch((err) => {
  console.error("[run-sync] FALLO:", err);
  process.exit(1);
});
