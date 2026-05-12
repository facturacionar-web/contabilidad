-- ============================================================
-- Falabella Chile - Tablas de órdenes desde Seller Center
-- ============================================================

create table if not exists public.falabella_orders (
  user_id           uuid not null references auth.users(id) on delete cascade,
  order_id          bigint not null,                    -- OrderId (interno Falabella, único global)
  order_number      bigint,                              -- OrderNumber (visible al cliente)
  created_at_fb     timestamptz not null,                -- CreatedAt en Falabella
  updated_at_fb     timestamptz,
  customer_rut      text,                                -- NationalRegistrationNumber
  items_count       integer,
  grand_total       numeric(14,2) not null,
  product_total     numeric(14,2),
  tax_amount        numeric(14,2),
  shipping_fee      numeric(14,2),
  voucher_amount    numeric(14,2),
  status            text,                                -- Statuses.Status agregado
  shipping_type     text,
  operator_code     text,                                -- "facl" en Chile
  currency          text default 'CLP',
  raw               jsonb,
  synced_at         timestamptz not null default now(),
  primary key (user_id, order_id)
);
create index if not exists idx_fb_orders_fecha
  on public.falabella_orders(user_id, created_at_fb desc);
create index if not exists idx_fb_orders_status
  on public.falabella_orders(user_id, status);

create table if not exists public.falabella_order_items (
  user_id              uuid not null references auth.users(id) on delete cascade,
  order_item_id        bigint not null,                  -- OrderItemId
  order_id             bigint not null,
  name                 text,
  sku                  text,
  shop_sku             text,
  variation            text,
  status               text,
  item_price           numeric(14,2),
  paid_price           numeric(14,2),
  voucher_amount       numeric(14,2),
  tax_amount           numeric(14,2),
  shipping_amount      numeric(14,2),
  shipping_service_cost numeric(14,2),
  shipping_tax         numeric(14,2),
  wallet_credits       numeric(14,2),
  currency             text,
  shipment_provider    text,
  tracking_code        text,
  package_id           text,
  sales_type           text,
  is_digital           boolean,
  return_status        text,
  created_at_fb        timestamptz,
  updated_at_fb        timestamptz,
  raw                  jsonb,
  synced_at            timestamptz not null default now(),
  primary key (user_id, order_item_id)
);
create index if not exists idx_fb_items_order
  on public.falabella_order_items(user_id, order_id);
create index if not exists idx_fb_items_fecha
  on public.falabella_order_items(user_id, created_at_fb desc);

create table if not exists public.falabella_sync_runs (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  status              text not null check (status in ('running','ok','error')),
  ordenes_nuevas      integer not null default 0,
  ordenes_actualizadas integer not null default 0,
  items_upsert        integer not null default 0,
  desde_iso           text,
  hasta_iso           text,
  error_mensaje       text,
  raw                 jsonb
);
create index if not exists idx_fb_runs_user
  on public.falabella_sync_runs(user_id, started_at desc);

-- RLS
alter table public.falabella_orders      enable row level security;
alter table public.falabella_order_items enable row level security;
alter table public.falabella_sync_runs   enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['falabella_orders','falabella_order_items','falabella_sync_runs'])
  loop
    execute format('drop policy if exists "own_select" on public.%I', t);
    execute format('drop policy if exists "own_insert" on public.%I', t);
    execute format('drop policy if exists "own_update" on public.%I', t);
    execute format('drop policy if exists "own_delete" on public.%I', t);

    execute format($p$create policy "own_select" on public.%I for select using ((select auth.uid()) = user_id)$p$, t);
    execute format($p$create policy "own_insert" on public.%I for insert with check ((select auth.uid()) = user_id)$p$, t);
    execute format($p$create policy "own_update" on public.%I for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)$p$, t);
    execute format($p$create policy "own_delete" on public.%I for delete using ((select auth.uid()) = user_id)$p$, t);
  end loop;
end $$;

-- Vista de resumen mensual (igual patrón que arca/sii)
create or replace view public.falabella_resumen_mensual_v as
select
  user_id,
  to_char(created_at_fb, 'YYYY-MM') as mes,
  count(*)              as cantidad,
  count(*) filter (where status = 'delivered') as cant_entregadas,
  count(*) filter (where status in ('canceled', 'failed', 'returned')) as cant_canceladas,
  sum(grand_total)      as total_bruto,
  sum(grand_total) filter (where status not in ('canceled', 'failed', 'returned')) as total_neto,
  sum(voucher_amount)   as total_voucher
from public.falabella_orders
group by user_id, to_char(created_at_fb, 'YYYY-MM');

grant select on public.falabella_resumen_mensual_v to authenticated;
