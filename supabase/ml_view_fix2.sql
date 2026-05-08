-- ============================================================
-- ML - Migración: usar date_closed (cierre/pago) en lugar de date_created
-- ============================================================
-- date_closed alinea con la fecha de emisión del comprobante en ARCA.
-- date_created es cuando el comprador inició la orden (puede no haber pagado).
--
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

create or replace view public.ml_resumen_mensual_v as
select
  to_char(date_closed at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') as mes,
  sum(coalesce(paid_amount, total_amount)) as total_ml,
  count(*) as cantidad
from public.ml_ordenes
where status in ('paid', 'partially_paid')
  and date_closed is not null
group by 1;

grant select on public.ml_resumen_mensual_v to authenticated;
