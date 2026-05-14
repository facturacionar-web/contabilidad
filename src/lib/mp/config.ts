/**
 * Configuración de Mercado Pago API.
 *
 * IMPORTANTE: MP comparte OAuth con Mercado Libre. El access_token de la app
 * "Alegrant - Librenta" (Client ID 4015678005897803) sirve para llamar TANTO
 * /v1/payments/search como /v1/account/release_report. NO se hace un OAuth
 * separado para MP — se reusa ml_oauth_cache.
 *
 * Endpoints accesibles con el scope actual:
 *  - /v1/payments/search                 (lectura de pagos — calendario)
 *  - /v1/account/release_report/*        (reportes de liberación — cierre diario)
 *  - /v1/account/settlement_report/*     (idem, formato distinto)
 *
 * Endpoints NO accesibles (403 con el scope actual):
 *  - /withdrawals/search                 — sin scope
 *  - /v1/account/movements/search        — deprecado (404)
 *  - /users/{id}/mercadopago_account/balance — sin scope
 *
 * Por eso los withdrawals salen del release_report (filas con
 * description=payout y PAYOUT_BANK_ACCOUNT_NUMBER no vacío).
 */

export const MP_API_BASE = "https://api.mercadopago.com";

/** Default seller para Librenta. Si tuviera múltiples cuentas MP, se itera por mp_user_id en cuentas. */
export const DEFAULT_MP_USER_ID = 128577788;

/** TZ en la que MP devuelve money_release_date (-04:00 a veces, pero el día calendario es AR). */
export const AR_TZ_OFFSET = "-03:00";

/**
 * UUIDs de la tabla `conceptos` (catálogo) usados al insertar ingresos/gastos.
 * Deben existir en la DB; si los renombran o borran, falla con FK.
 */
export const CONCEPTO_ID_LIQUIDACION_MP = "d4eaa52f-4526-4845-b955-c457cf071efb";       // "Liquidacion diaria MP"
export const CONCEPTO_ID_TRANSFERENCIAS_PROPIAS = "ed8a260c-8264-4f55-a689-aa1b8c0b4d99"; // "Transferencias a cuentas propias"
export const CONCEPTO_ID_IMPUESTO_DEB_CRED = "e24ce24e-2b1d-4a17-b485-0f49a2ee72fa";    // "Impuesto debitos y creditos"

/**
 * Alícuota del impuesto a los débitos y créditos bancarios (Argentina).
 * 0.6% por defecto. Cuando MP debita un pago a un destino que NO es una cuenta
 * propia (= pago a proveedor), el monto debitado incluye este impuesto.
 *   monto_factura = monto_payout / (1 + IMPUESTO_DEB_CRED_RATE)
 *   impuesto      = monto_payout - monto_factura
 */
export const IMPUESTO_DEB_CRED_RATE = 0.006;
