-- ============================================================
-- ML - Agregar campos de documento del comprador
-- ============================================================
-- Estos vienen de /orders/{id}/billing_info de ML, que se llama por cada
-- orden (no viene en /orders/search).
--
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

alter table public.ml_ordenes
  add column if not exists doc_tipo_buyer text,
  add column if not exists doc_nro_buyer bigint,
  add column if not exists billing_synced_at timestamptz;

-- Índice para JOIN con arca_comprobantes_emitidos
create index if not exists idx_ml_ordenes_doc_nro
  on public.ml_ordenes(doc_nro_buyer)
  where doc_nro_buyer is not null;
