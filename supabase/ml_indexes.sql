-- ============================================================
-- ML - Índices para acelerar queries de la página de ventas
-- ============================================================
-- Sin estos índices, las queries con count exact sobre 88k+ filas
-- y filtros por date_closed/status timing out a los 8 segundos.
-- ============================================================

-- date_closed parcial (solo donde no es null) — usado en todos los filtros
create index if not exists idx_ml_ordenes_date_closed
  on public.ml_ordenes(date_closed desc)
  where date_closed is not null;

-- status + date_closed — para filtrar por estado y rango
create index if not exists idx_ml_ordenes_status_date_closed
  on public.ml_ordenes(status, date_closed desc)
  where date_closed is not null;

-- ml_seller_id + date_closed — para filtrar por seller específico
create index if not exists idx_ml_ordenes_seller_date_closed
  on public.ml_ordenes(ml_seller_id, date_closed desc)
  where date_closed is not null;

-- ml_order_id (para búsqueda por número exacto)
create index if not exists idx_ml_ordenes_order_id
  on public.ml_ordenes(ml_order_id);

-- buyer_nickname (para búsqueda por comprador)
create index if not exists idx_ml_ordenes_buyer_nick
  on public.ml_ordenes(buyer_nickname);
