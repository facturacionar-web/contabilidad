/**
 * UUIDs de conceptos compartidos entre múltiples componentes/páginas.
 * Estos conceptos viven en la tabla `public.conceptos` y son referenciados
 * por gastos/ingresos creados automáticamente (cron MP, form pagos, etc).
 */

/** Concepto "Diferencia de tasa de cambio" — usado para registrar la pérdida
 *  cambiaria cuando se paga una factura en USD con tasa mayor a la cargada. */
export const CONCEPTO_ID_DIFERENCIA_TASA = "3cff7325-2203-4f06-b0e4-4fec39b59ec8";

/** Identifica un gasto generado automáticamente por la lógica de "Diferencia
 *  de tasa de cambio" subordinado a un pago padre. Devuelve el id del pago
 *  padre, o null si no es subordinado. */
export function getPagoPadreFromNotas(notas: string | null | undefined): number | null {
  if (typeof notas !== "string") return null;
  const m = notas.match(/^\[diff-tasa:pago-(\d+)\]/);
  return m ? Number(m[1]) : null;
}
