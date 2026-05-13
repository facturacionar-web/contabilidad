-- ============================================================
-- Vistas agregadas sobre mp_release_calendar para alimentar
-- el dashboard sin traer las miles de filas crudas al browser.
-- ============================================================

-- Proyección agrupada por día (solo pagos pending). Equivalente a:
--   SELECT fecha_liberacion, COUNT(*), SUM(net_received_amount)
--   FROM mp_release_calendar
--   WHERE money_release_status = 'pending'
--   GROUP BY fecha_liberacion;
create or replace view public.v_mp_calendar_proyeccion as
select
  user_id,
  fecha_liberacion as fecha,
  count(*)::int as cantidad,
  sum(net_received_amount)::numeric(14,2) as monto
from public.mp_release_calendar
where money_release_status = 'pending'
group by user_id, fecha_liberacion;

-- RLS de la vista: usa la RLS de mp_release_calendar (que tiene auth_select),
-- pero Postgres requiere policies explícitas en vistas con security_invoker.
alter view public.v_mp_calendar_proyeccion set (security_invoker = true);

-- Permitir SELECT a authenticated (la vista hereda RLS de la tabla base)
grant select on public.v_mp_calendar_proyeccion to authenticated;
