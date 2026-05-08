-- ============================================================
-- Vista de match ML ↔ ARCA por DNI + fecha + monto
-- ============================================================
-- Para cada orden ML cerrada con doc del comprador, busca el comprobante
-- ARCA con:
--   - mismo doc_nro
--   - fecha_cbte dentro de ±3 días del date_closed
--   - imp_total dentro de ±1 peso del paid_amount (cubre redondeos)
--
-- Si hay múltiples matches, devuelve el más cercano en fecha.
-- ============================================================

create or replace view public.ml_with_arca_match_v as
select
  ml.id,
  ml.ml_order_id,
  ml.ml_seller_id,
  ml.date_closed,
  ml.paid_amount,
  ml.total_amount,
  ml.shipping_cost,
  ml.status,
  ml.buyer_nickname,
  ml.doc_tipo_buyer,
  ml.doc_nro_buyer,
  arca_match.id           as arca_id,
  arca_match.cbte_tipo    as arca_cbte_tipo,
  arca_match.pto_vta      as arca_pto_vta,
  arca_match.cbte_nro     as arca_cbte_nro,
  arca_match.fecha_cbte   as arca_fecha,
  arca_match.imp_total    as arca_imp_total
from public.ml_ordenes ml
left join lateral (
  select arca.id, arca.cbte_tipo, arca.pto_vta, arca.cbte_nro,
         arca.fecha_cbte, arca.imp_total
  from public.arca_comprobantes_emitidos arca
  where arca.doc_nro = ml.doc_nro_buyer
    and arca.fecha_cbte between (ml.date_closed::date - interval '3 days')
                            and (ml.date_closed::date + interval '3 days')
    and abs(arca.imp_total - coalesce(ml.paid_amount, ml.total_amount)) < 1
  order by abs(arca.fecha_cbte - ml.date_closed::date)
  limit 1
) arca_match on true
where ml.status in ('paid', 'partially_paid')
  and ml.doc_nro_buyer is not null;

grant select on public.ml_with_arca_match_v to authenticated;
