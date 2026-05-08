-- ============================================================
-- Vista de conciliación ARCA vs Mercado Libre por mes
-- ============================================================
-- Une los totales mensuales de ARCA (facturas + ND - NC) y ML (total_amount
-- de las órdenes pagadas) para comparar y detectar diferencias.
--
-- La idea: total ARCA y total ML deberían ser muy parecidos (±1-2%).
-- Si la diferencia es mayor, hay algo para revisar (factura olvidada, NC
-- pendiente, venta no facturada, etc.).
--
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

create or replace view public.arca_vs_ml_mensual_v as
with arca as (
  select mes,
         coalesce(facturas, 0) + coalesce(notas_debito, 0) - coalesce(notas_credito, 0) as total_arca,
         cantidad as cant_arca
  from public.arca_resumen_mensual_v
),
ml as (
  select mes,
         coalesce(total_ml, 0) as total_ml,
         cantidad as cant_ml
  from public.ml_resumen_mensual_v
)
select
  coalesce(a.mes, m.mes) as mes,
  coalesce(a.total_arca, 0) as total_arca,
  coalesce(m.total_ml, 0) as total_ml,
  coalesce(a.total_arca, 0) - coalesce(m.total_ml, 0) as diferencia,
  case
    when coalesce(m.total_ml, 0) = 0 then null
    else round(((coalesce(a.total_arca, 0) - coalesce(m.total_ml, 0)) / m.total_ml * 100)::numeric, 2)
  end as diferencia_pct,
  coalesce(a.cant_arca, 0) as cant_arca,
  coalesce(m.cant_ml, 0) as cant_ml
from arca a
full outer join ml m on a.mes = m.mes;

grant select on public.arca_vs_ml_mensual_v to authenticated;
