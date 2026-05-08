-- ============================================================
-- ML - Desglose por seller (cuenta de Mercado Libre)
-- ============================================================
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

-- 1. Agregar columna nickname a la cache de tokens (si no existe)
alter table public.ml_oauth_cache
  add column if not exists nickname text;

-- 2. Vista de resumen mensual desglosado por seller
create or replace view public.ml_resumen_mensual_seller_v as
select
  to_char(o.date_closed at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') as mes,
  o.ml_seller_id,
  coalesce(c.nickname, 'Seller ' || o.ml_seller_id::text) as seller_label,
  sum(coalesce(o.paid_amount, o.total_amount)) as total_ml,
  count(*) as cantidad
from public.ml_ordenes o
left join public.ml_oauth_cache c on c.ml_user_id = o.ml_seller_id
where o.status in ('paid', 'partially_paid')
  and o.date_closed is not null
group by 1, 2, 3;

grant select on public.ml_resumen_mensual_seller_v to authenticated;

-- 3. Lista de sellers conocidos (para el header de la tabla)
create or replace view public.ml_sellers_v as
select distinct
  ml_user_id as seller_id,
  coalesce(nickname, 'Seller ' || ml_user_id::text) as seller_label
from public.ml_oauth_cache
order by ml_user_id;

grant select on public.ml_sellers_v to authenticated;
