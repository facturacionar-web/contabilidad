/**
 * Test standalone de la integración SII Chile.
 *
 * Carga .env.local, autentica con el cert al portal del SII, y consulta
 * el resumen del mes actual para confirmar que la lib funciona desde
 * el runtime de Node.js de Alegrant.
 *
 * Correr:
 *   npx tsx scripts/test-sii.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { authenticateToPortal } from "../src/lib/sii/auth";
import { getResumenVentas } from "../src/lib/sii/rcv";
import { getCredentials, SII_ENV } from "../src/lib/sii/config";

async function main() {
  console.log(`[sii-test] Ambiente: ${SII_ENV}`);
  const { rut } = getCredentials();
  console.log(`[sii-test] RUT empresa: ${rut}`);

  console.log("[sii-test] Autenticando al portal con cert (mTLS)...");
  const client = await authenticateToPortal();
  console.log(`[sii-test] OK. Token de sesión: ${client.token?.slice(0, 8)}...`);
  console.log(`[sii-test] Cookies activas: ${[...client.cookies.keys()].join(", ")}`);

  try {
    // Mes anterior (más probable que tenga datos cerrados que el actual)
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const periodo = `${target.getFullYear()}${String(target.getMonth() + 1).padStart(2, "0")}`;

    console.log(`[sii-test] Consultando resumen para periodo ${periodo}...`);
    const resp = await getResumenVentas(client, rut, periodo);

    console.log(`[sii-test] respEstado: cod=${resp.respEstado.codRespuesta} msg=${resp.respEstado.msgeRespuesta ?? "(ok)"}`);
    console.log(`[sii-test] dataCabecera: RUT=${resp.dataCabecera?.dcvRutEmisor}-${resp.dataCabecera?.dcvDvEmisor}, op=${resp.dataCabecera?.dcvOperacion}, periodo=${resp.dataCabecera?.dcvPtributario}`);
    console.log(`[sii-test] Total documentos: ${resp.totDocRes}`);

    const items = resp.data ?? [];
    if (items.length === 0) {
      console.log(`[sii-test] Sin movimientos en ${periodo}.`);
    } else {
      console.log("\nDesglose por tipo de DTE:");
      console.log("Codigo  Tipo                                      Cantidad         Total");
      console.log("------  ----------------------------------------  --------  ------------");
      for (const it of items) {
        const tipo = (it.dcvNombreTipoDoc ?? "?").replace(/[áéíóúñ]/g, (c) => ({ á: "a", é: "e", í: "i", ó: "o", ú: "u", ñ: "n" } as Record<string, string>)[c]);
        console.log(
          `${String(it.rsmnTipoDocInteger).padEnd(6)}  ${tipo.slice(0, 40).padEnd(40)}  ${String(it.rsmnTotDoc).padStart(8)}  $${it.rsmnMntTotal.toLocaleString("es-CL").padStart(11)}`
        );
      }
    }

    console.log("\n[sii-test] OK - integración funcionando.");
  } finally {
    await client.dispatcher.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[sii-test] FALLO:", err);
  process.exit(1);
});
