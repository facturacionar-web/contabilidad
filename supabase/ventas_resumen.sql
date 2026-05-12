-- ============================================================
-- Vista consolidada de ventas Chile: unión de marketplaces por mes/canal
-- Hoy: solo Falabella. Al agregar Walmart/MercadoLibre Chile se agregan UNIONs.
-- ============================================================

create or replace view public.ventas_resumen_mensual_v as
select
  user_id,
  mes,
  'falabella'::text       as canal,
  cantidad,
  cant_entregadas,
  cant_canceladas,
  total_bruto,
  total_neto,
  total_voucher
from public.falabella_resumen_mensual_v
-- agregar UNION ALL con walmart_resumen_mensual_v y ml_cl_resumen_mensual_v cuando existan
;

grant select on public.ventas_resumen_mensual_v to authenticated;
