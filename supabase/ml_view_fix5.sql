-- ============================================================
-- ML - Vista con filtro sargable (usa índice)
-- ============================================================
-- El filtro `(date_closed at tz) >= timestamp '...'` no es sargable:
-- Postgres convierte cada fila antes de comparar. Cambiamos a comparar
-- directo con timestamptz, que sí puede usar el índice de date_closed.
--
-- 2026-01-01 00:00:00 ARG = 2026-01-01 03:00:00+00 UTC
-- ============================================================

create or replace view public.ml_resumen_mensual_v as
select
  to_char(date_closed at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') as mes,
  sum(coalesce(paid_amount, total_amount)) as total_ml,
  count(*) as cantidad
from public.ml_ordenes
where status in ('paid', 'partially_paid')
  and date_closed >= '2026-01-01 03:00:00+00'::timestamptz
group by 1;

grant select on public.ml_resumen_mensual_v to authenticated;

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
  and o.date_closed >= '2026-01-01 03:00:00+00'::timestamptz
group by 1, 2, 3;

grant select on public.ml_resumen_mensual_seller_v to authenticated;
