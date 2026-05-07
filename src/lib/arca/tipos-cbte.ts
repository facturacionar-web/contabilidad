/**
 * Tipos de comprobante de ARCA agrupados según su rol en el resumen mensual.
 *
 * Para LIBRENTA, las ventas se calculan así:
 *   total = sum(facturas) + sum(notas_debito) - sum(notas_credito)
 *
 * Estos arrays están alineados con la lógica de
 * /arca/resumen-mensual y los filtros del listado.
 */

export const TIPO_FACTURAS = [1, 6, 11, 51] as const;       // A, B, C, A con leyenda
export const TIPO_NOTAS_DEBITO = [2, 7, 12, 52] as const;
export const TIPO_NOTAS_CREDITO = [3, 8, 13, 53] as const;

export const TIPOS_RELEVANTES = [
  ...TIPO_FACTURAS,
  ...TIPO_NOTAS_DEBITO,
  ...TIPO_NOTAS_CREDITO,
];

export const TIPO_LABEL: Record<number, string> = {
  1: "Factura A",
  2: "ND A",
  3: "NC A",
  6: "Factura B",
  7: "ND B",
  8: "NC B",
  11: "Factura C",
  12: "ND C",
  13: "NC C",
  51: "Factura A (ret.)",
  52: "ND A (ret.)",
  53: "NC A (ret.)",
};

export function tipoLabel(tipo: number): string {
  return TIPO_LABEL[tipo] ?? `Tipo ${tipo}`;
}

export function rolDelTipo(tipo: number): "factura" | "nota_debito" | "nota_credito" | "otro" {
  if ((TIPO_FACTURAS as readonly number[]).includes(tipo)) return "factura";
  if ((TIPO_NOTAS_DEBITO as readonly number[]).includes(tipo)) return "nota_debito";
  if ((TIPO_NOTAS_CREDITO as readonly number[]).includes(tipo)) return "nota_credito";
  return "otro";
}
