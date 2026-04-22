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
