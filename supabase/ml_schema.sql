-- ============================================================
-- Mercado Libre - Tablas para integración con la API de órdenes
-- AISLADAS: prefijo ml_*. NO modifica tablas existentes.
-- Ejecutar en Supabase SQL Editor.
-- ============================================================
-- Mismo modelo que ARCA: los datos son de la EMPRESA, no de cada usuario.
-- RLS: SELECT abierto a authenticated; escritura solo service-role (cron).

-- 1. Cache del OAuth (access_token + refresh_token por seller)
create table if not exists public.ml_oauth_cache (
  user_id           uuid not null references auth.users(id) on delete cascade,
  ml_user_id        bigint not null,                -- id del seller en ML
  access_token      text not null,
  refresh_token     text not null,
  expira_at         timestamptz not null,
  scope             text,
  updated_at        timestamptz not null default now(),
  primary key (user_id, ml_user_id)
);

-- 2. Checkpoint para sync incremental
create table if not exists public.ml_sync_checkpoint (
  user_id                    uuid not null references auth.users(id) on delete cascade,
  ml_seller_id               bigint not null,
  ultima_fecha_sincronizada  timestamptz not null default '2026-01-01T00:00:00Z',
  updated_at                 timestamptz not null default now(),
  primary key (user_id, ml_seller_id)
);

-- 3. Órdenes de venta de ML
create table if not exists public.ml_ordenes (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  ml_order_id     bigint not null,
  ml_seller_id    bigint not null,
  date_created    timestamptz not null,
  date_closed     timestamptz,
  status          text,                              -- paid, cancelled, etc.
  total_amount    numeric(14,2) not null,            -- lo que el comprador pagó (incluye envío que él banca)
  paid_amount     numeric(14,2),
  currency_id     text,                              -- ARS, USD
  shipping_cost   numeric(14,2),                     -- costo del envío que pagó el comprador
  buyer_id        bigint,
  buyer_nickname  text,
  pack_id         bigint,                            -- agrupación cuando vienen varios items
  items           jsonb,                             -- array de order_items completo
  raw             jsonb,                             -- respuesta completa
  synced_at       timestamptz not null default now(),
  unique (user_id, ml_order_id)
);
create index if not exists idx_ml_ordenes_user_fecha
  on public.ml_ordenes(user_id, date_created desc);
create index if not exists idx_ml_ordenes_seller
  on public.ml_ordenes(user_id, ml_seller_id, date_created desc);

-- 4. Log de ejecuciones
create table if not exists public.ml_sync_runs (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null check (status in ('running','ok','error')),
  ordenes_nuevas  integer not null default 0,
  error_mensaje   text,
  raw             jsonb
);
create index if not exists idx_ml_sync_runs_user
  on public.ml_sync_runs(user_id, started_at desc);

-- ============================================================
-- RLS: SELECT abierto a authenticated, INSERT/UPDATE/DELETE solo service-role
-- ============================================================

alter table public.ml_oauth_cache       enable row level security;
alter table public.ml_sync_checkpoint   enable row level security;
alter table public.ml_ordenes           enable row level security;
alter table public.ml_sync_runs         enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array[
    'ml_oauth_cache',
    'ml_sync_checkpoint',
    'ml_ordenes',
    'ml_sync_runs'
  ])
  loop
    execute format('drop policy if exists "authed_select" on public.%I', t);
    execute format(
      $p$create policy "authed_select" on public.%I for select to authenticated using (true)$p$,
      t
    );
  end loop;
end $$;

-- ============================================================
-- Vista: resumen mensual de ML (espejo de arca_resumen_mensual_v)
-- ============================================================
-- Usamos paid_amount porque incluye el envío que pagó el comprador.
-- total_amount son solo los items sin envío.
create or replace view public.ml_resumen_mensual_v as
select
  to_char(date_created at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM') as mes,
  sum(coalesce(paid_amount, total_amount)) as total_ml,
  count(*) as cantidad
from public.ml_ordenes
where status in ('paid', 'partially_paid')   -- solo las efectivamente pagadas
group by 1;

grant select on public.ml_resumen_mensual_v to authenticated;
