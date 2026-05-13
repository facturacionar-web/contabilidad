-- ============================================================
-- Vistas agregadas sobre mp_release_calendar para alimentar
-- el dashboard sin traer las miles de filas crudas al browser.
-- ============================================================

-- Proyección agrupada por día (solo pagos pending), JOIN con cuentas para
-- exponer ctx_pais — así el dashboard de cada país (AR/CL/MX) solo ve sus
-- propias liquidaciones, filtrando con paisFilter() en useTable.
drop view if exists public.v_mp_calendar_proyeccion;
create view public.v_mp_calendar_proyeccion as
select
  c.user_id,
  c.ctx_pais,
  mrc.fecha_liberacion as fecha,
  count(*)::int as cantidad,
  sum(mrc.net_received_amount)::numeric(14,2) as monto
from public.mp_release_calendar mrc
join public.cuentas c
  on c.mp_user_id = mrc.mp_user_id
 and c.user_id = mrc.user_id
where mrc.money_release_status = 'pending'
  and c.deleted_at is null
group by c.user_id, c.ctx_pais, mrc.fecha_liberacion;

alter view public.v_mp_calendar_proyeccion set (security_invoker = true);
grant select on public.v_mp_calendar_proyeccion to authenticated;
