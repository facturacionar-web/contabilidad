-- ============================================================
-- Convertir vistas de resumen a MATERIALIZED VIEWS
-- ============================================================
-- Las views simples escanean 100k+ filas en cada SELECT y dan timeout.
-- Las MV se calculan una vez y la lectura es instantánea.
-- Hay que refrescarlas post-sync (lo hacen los endpoints automáticamente).
--
-- Nota: usamos REFRESH MATERIALIZED VIEW CONCURRENTLY más adelante, que
-- requiere un índice UNIQUE en cada MV (lo creamos abajo).
-- ============================================================

-- 1. Drop vistas viejas
drop view if exists public.arca_resumen_mensual_v cascade;
drop view if exists public.ml_resumen_mensual_v cascade;
drop view if exists public.ml_resumen_mensual_seller_v cascade;
drop view if exists public.arca_vs_ml_mensual_v cascade;

-- 2. ARCA: resumen mensual
create materialized view public.arca_resumen_mensual_v as
select
  to_char(fecha_cbte, 'YYYY-MM') as mes,
  sum(case when cbte_tipo in (1, 6, 11, 51) then imp_total else 0 end) as facturas,
  sum(case when cbte_tipo in (2, 7, 12, 52) then imp_total else 0 end) as notas_debito,
  sum(case when cbte_tipo in (3, 8, 13, 53) then imp_total else 0 end) as notas_credito,
  count(*) as cantidad
from public.arca_comprobantes_emitidos
where cbte_tipo in (1, 2, 3, 6, 7, 8, 11, 12, 13, 51, 52, 53)
group by 1;

create unique index on public.arca_resumen_mensual_v (mes);
grant select on public.arca_resumen_mensual_v to authenticated;

-- 3. ML: resumen mensual total
create materialized view public.ml_resumen_mensual_v as
select
  to_char(date_closed at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') as mes,
  sum(coalesce(paid_amount, total_amount)) as total_ml,
  count(*) as cantidad
from public.ml_ordenes
where status in ('paid', 'partially_paid', 'partially_refunded')
  and date_closed >= '2026-01-01 03:00:00+00'::timestamptz
group by 1;

create unique index on public.ml_resumen_mensual_v (mes);
grant select on public.ml_resumen_mensual_v to authenticated;

-- 4. ML: resumen mensual por seller
create materialized view public.ml_resumen_mensual_seller_v as
select
  to_char(o.date_closed at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') as mes,
  o.ml_seller_id,
  coalesce(c.nickname, 'Seller ' || o.ml_seller_id::text) as seller_label,
  sum(coalesce(o.paid_amount, o.total_amount)) as total_ml,
  count(*) as cantidad
from public.ml_ordenes o
left join public.ml_oauth_cache c on c.ml_user_id = o.ml_seller_id
where o.status in ('paid', 'partially_paid', 'partially_refunded')
  and o.date_closed >= '2026-01-01 03:00:00+00'::timestamptz
group by 1, 2, 3;

create unique index on public.ml_resumen_mensual_seller_v (mes, ml_seller_id);
grant select on public.ml_resumen_mensual_seller_v to authenticated;

-- 5. Función helper para refrescar todas las MV (la llamamos desde endpoints)
create or replace function public.refresh_resumen_views()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.arca_resumen_mensual_v;
  refresh materialized view concurrently public.ml_resumen_mensual_v;
  refresh materialized view concurrently public.ml_resumen_mensual_seller_v;
end;
$$;

grant execute on function public.refresh_resumen_views() to authenticated;
