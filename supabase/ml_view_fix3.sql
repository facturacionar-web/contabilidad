-- ============================================================
-- ML - Filtro de las vistas para excluir cierres anteriores a 2026-01-01 ARG
-- ============================================================
-- Las vistas agrupan por date_closed en hora Argentina. Algunas órdenes con
-- date_closed entre 00:00-03:00 UTC del 1-ene-2026 caen en 31-dic-2025 ARG,
-- ensuciando los reportes. Las filtramos.
-- ============================================================

create or replace view public.ml_resumen_mensual_v as
select
  to_char(date_closed at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') as mes,
  sum(coalesce(paid_amount, total_amount)) as total_ml,
  count(*) as cantidad
from public.ml_ordenes
where status in ('paid', 'partially_paid')
  and date_closed is not null
  and date_closed >= ('2026-01-01'::date at time zone 'America/Argentina/Buenos_Aires')
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
  and o.date_closed is not null
  and o.date_closed >= ('2026-01-01'::date at time zone 'America/Argentina/Buenos_Aires')
group by 1, 2, 3;

grant select on public.ml_resumen_mensual_seller_v to authenticated;
