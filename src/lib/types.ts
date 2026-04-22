import { CountryCode, CurrencyCode } from "./countries";

export type ContactoTipo = "cliente" | "proveedor" | "ambos";

export interface Contacto {
  id: number;
  user_id?: string;
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
  fecha: string;
  tipo: IngresoTipo;
  contacto_id?: number | null;
  concepto: string;
  categoria: string;
  monto: number;
  moneda: CurrencyCode;
  metodo_pago: string;
  referencia?: string | null;
  notas?: string | null;
  created_at?: string;
}

export type GastoTipo = "gasto" | "factura_proveedor";
export type GastoEstado = "pagado" | "pendiente" | "parcial";

export interface Gasto {
  id: number;
  user_id?: string;
  fecha: string;
  fecha_vencimiento?: string | null;
  tipo: GastoTipo;
  contacto_id?: number | null;
  numero_factura?: string | null;
  concepto: string;
  categoria: string;
  subtotal: number;
  iva: number;
  iva_monto: number;
  total: number;
  moneda: CurrencyCode;
  estado: GastoEstado;
  metodo_pago?: string | null;
  monto_pagado: number;
  notas?: string | null;
  created_at?: string;
}

export type NotaCreditoTipo = "emitida" | "recibida";

export interface NotaCredito {
  id: number;
  user_id?: string;
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
