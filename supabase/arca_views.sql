-- ============================================================
-- ARCA - Vistas optimizadas para la UI
-- ============================================================
-- La página /arca/resumen-mensual antes traía los 100k+ comprobantes y los
-- agregaba en cliente. Con esta vista hace el agregado en Postgres y trae
-- solo ~12-24 filas (una por mes). Mucho más rápido.
--
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

create or replace view public.arca_resumen_mensual_v as
select
  to_char(fecha_cbte, 'YYYY-MM') as mes,
  sum(case when cbte_tipo in (1, 6, 11, 51) then imp_total else 0 end) as facturas,
  sum(case when cbte_tipo in (2, 7, 12, 52) then imp_total else 0 end) as notas_debito,
  sum(case when cbte_tipo in (3, 8, 13, 53) then imp_total else 0 end) as notas_credito,
  count(*) as cantidad
from public.arca_comprobantes_emitidos
where cbte_tipo in (1, 2, 3, 6, 7, 8, 11, 12, 13, 51, 52, 53)
group by to_char(fecha_cbte, 'YYYY-MM');

-- Las vistas heredan los permisos de las tablas subyacentes.
-- arca_comprobantes_emitidos ya tiene RLS con select abierta a authenticated.

-- Permisos explícitos por las dudas (asegurarnos que la vista sea consultable)
grant select on public.arca_resumen_mensual_v to authenticated;

-- ============================================================
-- VIEW liviana con los PtoVta presentes en la tabla.
-- Sirve para poblar el dropdown del listado /arca/comprobantes.
-- ============================================================
create or replace view public.arca_ptos_venta_v as
select distinct pto_vta
from public.arca_comprobantes_emitidos
order by pto_vta;

grant select on public.arca_ptos_venta_v to authenticated;
