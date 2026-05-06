import { CountryCode, CurrencyCode } from "./countries";

export type ContactoTipo = "cliente" | "proveedor" | "ambos";

export interface Contacto {
  id: number;
  user_id?: string;
  ctx_pais?: string | null;
  tipo: ContactoTipo;
  nombre: string;
  tax_id?: string | null;
  email?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  pais?: CountryCode | null;
  notas?: string | null;
  created_at?: string;
}

export type IngresoTipo = "ingreso_dinero" | "otro_ingreso";

export interface Ingreso {
  id: number;
  user_id?: string;
  ctx_pais?: string | null;
  fecha: string;
  tipo: IngresoTipo;
  contacto_id?: number | null;
  concepto: string;
  categoria: string;
  concepto_id?: string | null;
  cuenta_id?: string | null;
  monto: number;
  moneda: CurrencyCode;
  tasa_cambio?: number | null;
  metodo_pago: string;
  referencia?: string | null;
  notas?: string | null;
  created_at?: string;
}

export type GastoTipo = "gasto" | "factura_proveedor";
export type GastoEstado = "pagado" | "pendiente" | "parcial";

export interface FacturaItem {
  concepto_id: string | null;
  concepto_nombre: string;
  precio: number;
  descuento: number;
  impuesto: number;
  cantidad: number;
  observaciones: string;
  neto: number;
  iva_monto: number;
  total: number;
}

export interface Retencion {
  tipo: string;
  monto: number;
}

export interface FacturaPago {
  factura_id: number;
  numero_factura: string | null;
  total_factura: number;
  monto_pagado_antes: number;
  monto: number;
  retenciones: Retencion[];
}

export interface Gasto {
  id: number;
  user_id?: string;
  ctx_pais?: string | null;
  fecha: string;
  fecha_vencimiento?: string | null;
  tipo: GastoTipo;
  contacto_id?: number | null;
  numero_factura?: string | null;
  concepto: string;
  categoria: string;
  concepto_id?: string | null;
  cuenta_id?: string | null;
  subtotal: number;
  iva: number;
  iva_monto: number;
  total: number;
  moneda: CurrencyCode;
  estado: GastoEstado;
  metodo_pago?: string | null;
  monto_pagado: number;
  notas?: string | null;
  items?: FacturaItem[] | null;
  factura_pagos?: FacturaPago[] | null;
  tasa_cambio?: number | null;
  created_at?: string;
}

export type NotaCreditoTipo = "emitida" | "recibida";

export interface NotaCredito {
  id: number;
  user_id?: string;
  ctx_pais?: string | null;
  fecha: string;
  tipo: NotaCreditoTipo;
  contacto_id?: number | null;
  numero?: string | null;
  gasto_relacionado_id?: number | null;
  concepto: string;
  monto: number;
  moneda: CurrencyCode;
  tasa_cambio?: number | null;
  motivo: string;
  notas?: string | null;
  created_at?: string;
}

export type ConceptoTipo = "ingreso" | "egreso" | "ambos";

export interface Concepto {
  id: string; // uuid
  user_id?: string;
  ctx_pais?: string | null;
  nombre: string;
  tipo: ConceptoTipo;
  descripcion?: string | null;
  es_anticipo?: boolean;
  created_at?: string;
}

export interface AnticipoAplicacion {
  id: number;
  user_id?: string;
  ctx_pais: string;
  anticipo_pago_id: number;
  factura_id: number;
  monto: number;
  fecha: string;
  notas?: string | null;
  created_at?: string;
}

export type CuentaTipo = "banco" | "billetera" | "efectivo" | "otro";

export interface Cuenta {
  id: string; // uuid
  user_id?: string;
  ctx_pais?: string | null;
  nombre: string;
  tipo: CuentaTipo;
  moneda: CurrencyCode;
  descripcion?: string | null;
  created_at?: string;
}

export type ConciliacionTipo = "debito" | "credito";
export type ConciliacionEstado = "pendiente" | "conciliado" | "ignorado";
export type ConciliacionMatchedBy = "auto" | "manual" | "created";

export interface ConciliacionMovimiento {
  id: number;
  user_id?: string;
  ctx_pais: string;
  cuenta_id: string | null;
  fecha: string;
  descripcion: string | null;
  referencia: string | null;
  monto: number;
  tipo: ConciliacionTipo;
  matched_type: "pago" | "ingreso" | null;
  matched_id: number | null;
  matched_by: ConciliacionMatchedBy | null;
  matched_score: number | null;
  estado: ConciliacionEstado;
  raw: Record<string, unknown> | null;
  notas: string | null;
  imported_at?: string;
  reconciled_at?: string | null;
  imported_batch: string | null;
  deleted_at?: string | null;
}

export interface Config {
  user_id: string;
  pais: CountryCode;
  is_active: boolean;
  moneda_base: CurrencyCode;
  empresa_nombre: string;
  empresa_tax_id?: string | null;
  empresa_email?: string | null;
  empresa_telefono?: string | null;
  empresa_direccion?: string | null;
}
