-- ============================================================
-- Mercado Pago - Tablas para integración de liquidaciones y withdrawals
-- AISLADAS: prefijo mp_*. Reusa ml_oauth_cache para el access_token
-- (la app Alegrant - Librenta autoriza tanto ML como MP con el mismo OAuth).
--
-- Modelo (mismo patrón que ARCA/ML): los datos son de la EMPRESA, no de
-- cada usuario individual. RLS: SELECT abierto a authenticated; escritura
-- solo service-role (cron).
--
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

-- ------------------------------------------------------------
-- 1. mp_release_calendar — proyección de liquidaciones futuras
--    Alimentada por GET /v1/payments/search?range=money_release_date
--    Se refresca cada hora. Es la fuente del widget "Calendario de movimientos"
--    en el dashboard. NO es contable — solo proyección.
-- ------------------------------------------------------------
create table if not exists public.mp_release_calendar (
  user_id              uuid not null references auth.users(id) on delete cascade,
  mp_payment_id        bigint not null,                      -- payment.id en MP
  mp_user_id           bigint not null,                      -- seller (collector_id)
  fecha_liberacion     date not null,                        -- money_release_date local AR
  money_release_at     timestamptz not null,                 -- timestamp completo
  net_received_amount  numeric(14,2) not null,
  transaction_amount   numeric(14,2) not null,
  payment_status       text not null,                        -- approved | in_mediation | refunded | ...
  money_release_status text not null,                        -- pending | released | ...
  operation_type       text,                                 -- regular_payment | money_transfer | ...
  external_reference   text,                                 -- order_id ML cuando aplica
  date_created         timestamptz,
  updated_at           timestamptz not null default now(),
  primary key (user_id, mp_payment_id)
);
create index if not exists idx_mp_release_calendar_fecha
  on public.mp_release_calendar (user_id, fecha_liberacion);
create index if not exists idx_mp_release_calendar_status
  on public.mp_release_calendar (user_id, money_release_status, fecha_liberacion);

-- ------------------------------------------------------------
-- 2. mp_release_detail — filas del release_report CSV
--    Fuente de verdad oficial de MP. Cada fila es un movimiento (release,
--    payment, shipping, refund, mediation, reserve_for_dispute, payout, etc.).
--    Insertada por el cron de cierre diario. Cierre = sum(NET_CREDIT - NET_DEBIT)
--    de las filas de un día.
-- ------------------------------------------------------------
create table if not exists public.mp_release_detail (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,
  mp_user_id        bigint not null,
  fecha             date not null,                           -- DATE de la fila (fecha del movimiento)
  source_id         text,                                    -- SOURCE_ID (payment id, etc.)
  external_reference text,                                   -- EXTERNAL_REFERENCE
  record_type       text not null,                           -- release | total | ...
  description       text not null,                           -- payment | shipping | refund | payout | mediation | ...
  net_credit        numeric(14,2) not null default 0,
  net_debit         numeric(14,2) not null default 0,
  gross_amount      numeric(14,2) not null default 0,
  seller_amount     numeric(14,2) not null default 0,
  mp_fee_amount     numeric(14,2) not null default 0,
  financing_fee     numeric(14,2) not null default 0,
  shipping_fee      numeric(14,2) not null default 0,
  taxes_amount      numeric(14,2) not null default 0,
  coupon_amount     numeric(14,2) not null default 0,
  installments      int,
  payment_method    text,
  order_id          text,
  shipping_id       text,
  payout_cbu        text,                                    -- PAYOUT_BANK_ACCOUNT_NUMBER (solo en payouts)
  balance_amount    numeric(16,2),                           -- saldo después del movimiento
  raw               jsonb,                                   -- fila completa por si necesitamos más
  imported_at       timestamptz not null default now(),
  imported_batch    text not null                            -- ej: "manual-2026-05-12" o "cron-2026-05-12"
);
create index if not exists idx_mp_release_detail_fecha
  on public.mp_release_detail (user_id, fecha);
create index if not exists idx_mp_release_detail_desc
  on public.mp_release_detail (user_id, fecha, description);
create index if not exists idx_mp_release_detail_payout
  on public.mp_release_detail (user_id, payout_cbu) where payout_cbu is not null;
-- evitar doble import del mismo día
create unique index if not exists ux_mp_release_detail_dedup
  on public.mp_release_detail (user_id, fecha, source_id, description, net_credit, net_debit, gross_amount);

-- ------------------------------------------------------------
-- 3. mp_liquidaciones_diarias — 1 fila por día, link al ingreso de Alegrant
--    Esta es la tabla que "cierra al centavo": cada día tiene UN ingreso
--    en `public.ingresos` (cuenta_id=MP) cuyo monto = total_neto.
-- ------------------------------------------------------------
create table if not exists public.mp_liquidaciones_diarias (
  user_id              uuid not null references auth.users(id) on delete cascade,
  mp_user_id           bigint not null,
  fecha                date not null,
  cantidad_movimientos int not null,
  total_neto           numeric(14,2) not null,               -- = sum(net_credit - net_debit) del CSV, EXCLUYENDO payouts
  total_payouts        numeric(14,2) not null default 0,     -- suma de payouts del día (informativo)
  balance_final        numeric(16,2),                        -- saldo MP al cierre del día
  alegrant_ingreso_id  bigint references public.ingresos(id) on delete set null,
  generado_at          timestamptz not null default now(),
  primary key (user_id, mp_user_id, fecha)
);

-- ------------------------------------------------------------
-- 4. mp_withdrawals — transferencias MP → CBU propia (espejo de filas payout)
--    Cada withdrawal genera DOS registros en Alegrant para que la caja cierre:
--      - 1 GASTO  en cuenta MP    (sale plata de MP)
--      - 1 INGRESO en cuenta destino (entra plata al banco)
--    Ambos vinculados a este registro via los FKs.
-- ------------------------------------------------------------
create table if not exists public.mp_withdrawals (
  id                       bigint generated always as identity primary key,
  user_id                  uuid not null references auth.users(id) on delete cascade,
  mp_user_id               bigint not null,
  fecha                    timestamptz not null,
  monto                    numeric(14,2) not null,
  cbu_destino              text not null,
  mp_release_detail_id     bigint references public.mp_release_detail(id) on delete set null,
  cuenta_origen_id         uuid references public.cuentas(id),         -- cuenta MP (Alegrant)
  cuenta_destino_id        uuid references public.cuentas(id),         -- cuenta banco (Alegrant) si CBU mapeado
  alegrant_gasto_id        bigint references public.gastos(id) on delete set null,
  alegrant_ingreso_id      bigint references public.ingresos(id) on delete set null,
  created_at               timestamptz not null default now()
);
create unique index if not exists ux_mp_withdrawals_dedup
  on public.mp_withdrawals (user_id, fecha, monto, cbu_destino);
create index if not exists idx_mp_withdrawals_fecha
  on public.mp_withdrawals (user_id, fecha desc);

-- ------------------------------------------------------------
-- 5. Extender `cuentas` con CBU y mp_user_id para hacer el matching
--    automático CBU → cuenta destino, y mp_user_id → cuenta MP.
-- ------------------------------------------------------------
alter table public.cuentas
  add column if not exists cbu text,
  add column if not exists mp_user_id bigint;

create index if not exists idx_cuentas_cbu        on public.cuentas (cbu)        where cbu is not null;
create index if not exists idx_cuentas_mp_user_id on public.cuentas (mp_user_id) where mp_user_id is not null;

-- ------------------------------------------------------------
-- 6. Poblar mapeos conocidos (idempotente)
-- ------------------------------------------------------------
-- BBVA → CBU 0170331120000045057359 (vista en el release_report del 12/05)
update public.cuentas
   set cbu = '0170331120000045057359'
 where user_id = '7b19fa5f-5d64-41e1-9212-dfa5c8bd6d15'
   and nombre = 'BBVA'
   and (cbu is null or cbu = '');

-- Cuenta MP → seller_id 128577788 (LIBRENTA)
update public.cuentas
   set mp_user_id = 128577788
 where user_id = '7b19fa5f-5d64-41e1-9212-dfa5c8bd6d15'
   and nombre = 'Mercado Pago'
   and mp_user_id is null;

-- ------------------------------------------------------------
-- 7. Crear contacto proveedor "LIBRENTA LIBROS SAU" para los withdrawals
--    (cargarse a uno mismo como proveedor para que el módulo conciliación
--     pueda matchear las transferencias entre cuentas propias).
-- ------------------------------------------------------------
insert into public.contactos (user_id, tipo, nombre, tax_id, pais, notas)
select
  '7b19fa5f-5d64-41e1-9212-dfa5c8bd6d15'::uuid,
  'proveedor',
  'LIBRENTA LIBROS SAU',
  '30715103946',
  'AR',
  'Auto-creado: receptor de movimientos entre cuentas propias (transferencias desde MP)'
where not exists (
  select 1 from public.contactos
   where user_id = '7b19fa5f-5d64-41e1-9212-dfa5c8bd6d15'
     and tax_id = '30715103946'
);

-- ------------------------------------------------------------
-- 8. RLS para las 4 tablas mp_*
--    Mismo patrón que ml_*: SELECT abierto a authenticated, escritura
--    solo service-role (no policy = bloqueado para anon/authenticated).
-- ------------------------------------------------------------
alter table public.mp_release_calendar     enable row level security;
alter table public.mp_release_detail       enable row level security;
alter table public.mp_liquidaciones_diarias enable row level security;
alter table public.mp_withdrawals          enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['mp_release_calendar','mp_release_detail','mp_liquidaciones_diarias','mp_withdrawals'])
  loop
    execute format('drop policy if exists "auth_select" on public.%I', t);
    execute format($p$create policy "auth_select" on public.%I for select to authenticated using (true)$p$, t);
  end loop;
end $$;
