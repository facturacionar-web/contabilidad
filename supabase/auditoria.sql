-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ AUDITORÍA DE INTEGRIDAD DE DATOS                                ║
-- ║ Pegar en SQL Editor y ejecutar cada bloque por separado.        ║
-- ║ Cada query devuelve registros con problemas (vacío = todo OK).   ║
-- ╚══════════════════════════════════════════════════════════════════╝


-- ───────────────────────────────────────────────────────────────────
-- 1) Facturas con monto_pagado MAYOR que total
--    (no debería pasar nunca: indica bug previo o doble aplicación)
-- ───────────────────────────────────────────────────────────────────
select
  id,
  numero_factura,
  total,
  monto_pagado,
  monto_pagado - total as exceso,
  estado,
  contacto_id,
  fecha
from public.gastos
where tipo = 'factura_proveedor'
  and deleted_at is null
  and monto_pagado > total + 0.01
order by exceso desc;


-- ───────────────────────────────────────────────────────────────────
-- 2) Facturas con estado inconsistente con monto_pagado
--    pagado pero monto_pagado < total, o pendiente pero ya está pago, etc.
-- ───────────────────────────────────────────────────────────────────
select
  id,
  numero_factura,
  total,
  monto_pagado,
  estado,
  case
    when estado = 'pagado'    and monto_pagado < total - 0.01 then 'pagado pero falta plata'
    when estado = 'pendiente' and monto_pagado > 0.01           then 'pendiente pero ya pagaron algo'
    when estado = 'parcial'   and monto_pagado <= 0             then 'parcial sin pagos'
    when estado = 'parcial'   and monto_pagado >= total - 0.01  then 'parcial con todo pagado'
  end as problema
from public.gastos
where tipo = 'factura_proveedor'
  and deleted_at is null
  and (
       (estado = 'pagado'    and monto_pagado < total - 0.01)
    or (estado = 'pendiente' and monto_pagado > 0.01)
    or (estado = 'parcial'   and (monto_pagado <= 0 or monto_pagado >= total - 0.01))
  );


-- ───────────────────────────────────────────────────────────────────
-- 3) Anticipos aplicados a facturas que fueron borradas (soft delete)
--    Estos generan un saldo "fantasma" en el monto_pagado de una factura inexistente
-- ───────────────────────────────────────────────────────────────────
select
  aa.id as aplicacion_id,
  aa.anticipo_pago_id,
  aa.factura_id,
  aa.monto,
  aa.fecha,
  g.numero_factura,
  g.deleted_at as factura_borrada_en
from public.anticipos_aplicaciones aa
join public.gastos g on g.id = aa.factura_id
where g.deleted_at is not null;


-- ───────────────────────────────────────────────────────────────────
-- 4) Aplicaciones de anticipos que apuntan a un anticipo borrado
-- ───────────────────────────────────────────────────────────────────
select
  aa.id as aplicacion_id,
  aa.anticipo_pago_id,
  aa.factura_id,
  aa.monto,
  g.deleted_at as anticipo_borrado_en
from public.anticipos_aplicaciones aa
join public.gastos g on g.id = aa.anticipo_pago_id
where g.deleted_at is not null;


-- ───────────────────────────────────────────────────────────────────
-- 5) Pagos cuyo factura_pagos hace referencia a una factura inexistente o borrada
--    (pagos huérfanos)
-- ───────────────────────────────────────────────────────────────────
with refs as (
  select
    p.id as pago_id,
    (fp ->> 'factura_id')::bigint as factura_id,
    (fp ->> 'monto')::numeric as monto
  from public.gastos p,
       jsonb_array_elements(coalesce(p.factura_pagos, '[]'::jsonb)) as fp
  where p.tipo = 'gasto'
    and p.deleted_at is null
    and p.factura_pagos is not null
)
select r.pago_id, r.factura_id, r.monto, g.deleted_at as factura_estado
from refs r
left join public.gastos g on g.id = r.factura_id
where g.id is null
   or g.deleted_at is not null;


-- ───────────────────────────────────────────────────────────────────
-- 6) Movimientos de conciliación apuntando a gastos/ingresos eliminados
-- ───────────────────────────────────────────────────────────────────
select
  cm.id as movimiento_id,
  cm.fecha,
  cm.descripcion,
  cm.monto,
  cm.matched_type,
  cm.matched_id,
  cm.estado as estado_conciliacion
from public.conciliacion_movimientos cm
where cm.estado = 'conciliado'
  and (
    (cm.matched_type = 'pago' and not exists (
      select 1 from public.gastos g where g.id = cm.matched_id and g.deleted_at is null
    ))
    or (cm.matched_type = 'ingreso' and not exists (
      select 1 from public.ingresos i where i.id = cm.matched_id and i.deleted_at is null
    ))
  );


-- ───────────────────────────────────────────────────────────────────
-- 7) Contactos potencialmente duplicados (mismo CUIT/RFC)
-- ───────────────────────────────────────────────────────────────────
select
  tax_id,
  count(*) as cantidad,
  array_agg(id order by id) as ids,
  array_agg(nombre order by id) as nombres
from public.contactos
where deleted_at is null
  and tax_id is not null
  and length(trim(tax_id)) > 0
group by tax_id
having count(*) > 1;


-- ───────────────────────────────────────────────────────────────────
-- 8) Conceptos sin uso (huérfanos)
--    No están referenciados por ninguna factura, pago, ingreso o NC
-- ───────────────────────────────────────────────────────────────────
select c.id, c.nombre, c.tipo, c.created_at
from public.conceptos c
where c.deleted_at is null
  and not exists (select 1 from public.gastos g
                  where g.concepto_id = c.id and g.deleted_at is null)
  and not exists (select 1 from public.ingresos i
                  where i.concepto_id = c.id and i.deleted_at is null)
  and not exists (select 1 from public.gastos g,
                          jsonb_array_elements(coalesce(g.items, '[]'::jsonb)) as it
                  where (it ->> 'concepto_id') = c.id and g.deleted_at is null)
order by c.nombre;


-- ───────────────────────────────────────────────────────────────────
-- 9) Cuentas sin uso
-- ───────────────────────────────────────────────────────────────────
select c.id, c.nombre, c.tipo, c.moneda, c.created_at
from public.cuentas c
where c.deleted_at is null
  and not exists (select 1 from public.gastos g where g.cuenta_id = c.id and g.deleted_at is null)
  and not exists (select 1 from public.ingresos i where i.cuenta_id = c.id and i.deleted_at is null)
  and not exists (select 1 from public.conciliacion_movimientos cm where cm.cuenta_id = c.id and cm.deleted_at is null);


-- ───────────────────────────────────────────────────────────────────
-- 10) Notas de crédito con gasto_relacionado_id apuntando a factura inexistente
-- ───────────────────────────────────────────────────────────────────
select
  nc.id,
  nc.numero,
  nc.fecha,
  nc.monto,
  nc.gasto_relacionado_id
from public.notas_credito nc
left join public.gastos g on g.id = nc.gasto_relacionado_id
where nc.deleted_at is null
  and nc.gasto_relacionado_id is not null
  and (g.id is null or g.deleted_at is not null);


-- ───────────────────────────────────────────────────────────────────
-- 11) Aplicaciones de anticipos con monto <= 0 (no debería pasar)
-- ───────────────────────────────────────────────────────────────────
select id, anticipo_pago_id, factura_id, monto, fecha
from public.anticipos_aplicaciones
where monto <= 0;


-- ───────────────────────────────────────────────────────────────────
-- 12) Resumen general: registros activos / borrados por tabla
-- ───────────────────────────────────────────────────────────────────
select 'gastos' as tabla,
       count(*) filter (where deleted_at is null) as activos,
       count(*) filter (where deleted_at is not null) as borrados,
       count(*) as total
from public.gastos
union all
select 'ingresos',
       count(*) filter (where deleted_at is null),
       count(*) filter (where deleted_at is not null),
       count(*)
from public.ingresos
union all
select 'notas_credito',
       count(*) filter (where deleted_at is null),
       count(*) filter (where deleted_at is not null),
       count(*)
from public.notas_credito
union all
select 'contactos',
       count(*) filter (where deleted_at is null),
       count(*) filter (where deleted_at is not null),
       count(*)
from public.contactos
union all
select 'conceptos',
       count(*) filter (where deleted_at is null),
       count(*) filter (where deleted_at is not null),
       count(*)
from public.conceptos
union all
select 'cuentas',
       count(*) filter (where deleted_at is null),
       count(*) filter (where deleted_at is not null),
       count(*)
from public.cuentas
union all
select 'conciliacion_movimientos',
       count(*) filter (where deleted_at is null),
       count(*) filter (where deleted_at is not null),
       count(*)
from public.conciliacion_movimientos;


-- ───────────────────────────────────────────────────────────────────
-- 13) Eventos del audit log por usuario, últimos 30 días
-- ───────────────────────────────────────────────────────────────────
select
  user_email,
  action,
  count(*) as cantidad
from public.activity_log
where created_at > now() - interval '30 days'
group by user_email, action
order by user_email, action;
