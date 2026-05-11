-- ============================================================
-- SII Chile - Vista de resumen mensual para la UI
-- ============================================================
-- Equivalente a arca_resumen_mensual_v. La página /sii/resumen-mensual
-- consume esta vista en vez de calcular en cliente.
--
-- Fórmula contable:
--   Total = Facturas (33) + Facturas Exentas (34) + Boletas (39) +
--           Boletas Exentas (41) + Liquidaciones-Factura (43) +
--           Facturas de Exportación (110) + Notas de Débito (56)
--           − Notas de Crédito (61)
-- ============================================================

create or replace view public.sii_resumen_mensual_v as
select
  user_id,
  rut_emisor,
  substring(periodo from 1 for 4) || '-' || substring(periodo from 5 for 2) as mes,
  sum(case when cod_tipo_doc in (33, 34) then monto_total else 0 end) as facturas,
  sum(case when cod_tipo_doc in (39, 41) then monto_total else 0 end) as boletas,
  sum(case when cod_tipo_doc in (43)     then monto_total else 0 end) as liquidaciones,
  sum(case when cod_tipo_doc in (110)    then monto_total else 0 end) as facturas_export,
  sum(case when cod_tipo_doc in (56)     then monto_total else 0 end) as notas_debito,
  sum(case when cod_tipo_doc in (61)     then monto_total else 0 end) as notas_credito,
  sum(cantidad) as cantidad
from public.sii_resumen_mensual
where cod_tipo_doc in (33, 34, 39, 41, 43, 56, 61, 110)
group by user_id, rut_emisor, periodo;

grant select on public.sii_resumen_mensual_v to authenticated;
