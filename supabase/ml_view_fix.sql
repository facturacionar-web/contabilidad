-- ============================================================
-- ML - Fix: usar paid_amount (incluye envío del comprador) en vez de total_amount
-- ============================================================
-- ML tiene dos campos que confunden:
--   total_amount  → suma de unit_price × quantity (SIN envío del comprador)
--   paid_amount   → lo que efectivamente pagó el comprador (CON envío)
--
-- Para conciliar contra ARCA usamos paid_amount, que es el total real de la venta.
--
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

create or replace view public.ml_resumen_mensual_v as
select
  to_char(date_created at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') as mes,
  sum(coalesce(paid_amount, total_amount)) as total_ml,
  count(*) as cantidad
from public.ml_ordenes
where status in ('paid', 'partially_paid')
group by 1;

grant select on public.ml_resumen_mensual_v to authenticated;
