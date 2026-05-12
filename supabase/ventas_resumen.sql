-- ============================================================
-- Vista consolidada de ventas Chile: unión de marketplaces por mes/canal
-- Canales activos: Falabella, Walmart. (Mercado Libre Chile: pendiente)
-- ============================================================

create or replace view public.ventas_resumen_mensual_v as
select
  user_id, mes, 'falabella'::text as canal,
  cantidad, cant_entregadas, cant_canceladas,
  total_bruto, total_neto, total_voucher
from public.falabella_resumen_mensual_v
union all
select
  user_id, mes, 'walmart'::text as canal,
  cantidad, cant_entregadas, cant_canceladas,
  total_bruto, total_neto, total_voucher
from public.walmart_resumen_mensual_v
;

grant select on public.ventas_resumen_mensual_v to authenticated;
