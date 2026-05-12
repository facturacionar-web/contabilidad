-- ============================================================
-- ML multi-país: agregar site_id para distinguir MLA (AR) / MLC (CL) / etc.
-- ============================================================
-- site_id viene en /users/me del seller y en cada orden del API.
-- MLA=Argentina, MLC=Chile, MLM=México, MLB=Brasil, etc.

alter table public.ml_oauth_cache
  add column if not exists site_id text;

alter table public.ml_ordenes
  add column if not exists site_id text;

create index if not exists idx_ml_ordenes_site
  on public.ml_ordenes(site_id, date_closed desc);

-- Backfill site_id en órdenes existentes leyendo del raw JSON.
update public.ml_ordenes
  set site_id = coalesce(raw->>'site_id', null)
  where site_id is null;

-- Backfill site_id en ml_oauth_cache: inferir desde currency de las órdenes del seller.
update public.ml_oauth_cache c
  set site_id = sub.site_id
  from (
    select ml_seller_id, max(site_id) as site_id
    from public.ml_ordenes
    where site_id is not null
    group by ml_seller_id
  ) sub
  where c.ml_user_id = sub.ml_seller_id and c.site_id is null;

-- ============================================================
-- Vistas: resumen mensual por país
-- ============================================================

-- Resumen ML Argentina (compat con la vista materializada existente)
-- La materialized ya existe en arca_resumen_mensual_v? No, esa es de ARCA.
-- La de ML AR es ml_resumen_mensual_v. Dejamos esa intacta.

-- Resumen ML Chile (nueva)
create or replace view public.ml_cl_resumen_mensual_v as
select
  user_id,
  to_char(date_closed at time zone 'America/Santiago', 'YYYY-MM') as mes,
  count(*)                                                              as cantidad,
  count(*) filter (where status in ('paid','partially_paid'))           as cant_pagadas,
  count(*) filter (where status = 'cancelled')                          as cant_canceladas,
  sum(coalesce(paid_amount, total_amount))                              as total_bruto,
  sum(coalesce(paid_amount, total_amount))
    filter (where status in ('paid','partially_paid','partially_refunded'))  as total_neto
from public.ml_ordenes
where site_id = 'MLC' and date_closed is not null
group by user_id, to_char(date_closed at time zone 'America/Santiago', 'YYYY-MM');

grant select on public.ml_cl_resumen_mensual_v to authenticated;
