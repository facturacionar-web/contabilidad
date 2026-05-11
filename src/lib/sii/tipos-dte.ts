/**
 * Códigos de tipo de DTE (Documento Tributario Electrónico) del SII Chile.
 * Re-export desde config para que la UI los importe sin tocar internals.
 */

export const TIPO_FACTURAS = [33, 34, 110] as const;       // FE + FE Exenta + Factura Exportación
export const TIPO_LIQUIDACIONES = [43] as const;           // Liquidación-Factura
export const TIPO_NOTAS_DEBITO = [56] as const;            // ND Electrónica
export const TIPO_NOTAS_CREDITO = [61] as const;           // NC Electrónica
export const TIPO_BOLETAS = [39, 41] as const;             // Boleta + Boleta Exenta

// Tipos con detalle disponible vía getDetalleVenta (las boletas requieren consulta diferida)
export const TIPOS_CON_DETALLE = [
  ...TIPO_FACTURAS,
  ...TIPO_LIQUIDACIONES,
  ...TIPO_NOTAS_DEBITO,
  ...TIPO_NOTAS_CREDITO,
] as const;

export const TIPOS_RELEVANTES = [...TIPOS_CON_DETALLE] as const;

const LABELS: Record<number, string> = {
  33: "Factura Elec.",
  34: "Factura Exenta",
  39: "Boleta Elec.",
  41: "Boleta Exenta",
  43: "Liquidación-Fact.",
  46: "Factura de Compra",
  52: "Guía Despacho",
  56: "Nota de Débito",
  61: "Nota de Crédito",
  110: "Factura Exportación",
};

export function tipoLabel(codigo: number): string {
  return LABELS[codigo] ?? `DTE ${codigo}`;
}
