-- ============================================================
-- Walmart Chile Marketplace - Tablas de órdenes
-- ============================================================

create table if not exists public.walmart_token_cache (
  user_id       uuid not null references auth.users(id) on delete cascade,
  access_token  text not null,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now(),
  primary key (user_id)
);

create table if not exists public.walmart_orders (
  user_id              uuid not null references auth.users(id) on delete cascade,
  purchase_order_id    text not null,
  customer_order_id    text,
  order_date           timestamptz not null,
  estimated_ship_date  timestamptz,
  status               text,                       -- estado consolidado de las líneas
  total_amount         numeric(14,2),              -- suma de las líneas
  total_quantity       integer,
  currency             text default 'CLP',
  raw                  jsonb,
  synced_at            timestamptz not null default now(),
  primary key (user_id, purchase_order_id)
);
create index if not exists idx_walmart_orders_fecha
  on public.walmart_orders(user_id, order_date desc);
create index if not exists idx_walmart_orders_status
  on public.walmart_orders(user_id, status);

create table if not exists public.walmart_order_lines (
  user_id              uuid not null references auth.users(id) on delete cascade,
  purchase_order_id    text not null,
  line_number          text not null,
  sku                  text,
  product_name         text,
  quantity             integer,
  unit_price           numeric(14,2),
  line_amount          numeric(14,2),
  currency             text default 'CLP',
  status               text,
  tracking_url         text,
  enviame_delivery_id  text,
  carrier              text,
  tracking_number      text,
  raw                  jsonb,
  synced_at            timestamptz not null default now(),
  primary key (user_id, purchase_order_id, line_number)
);
create index if not exists idx_walmart_lines_po
  on public.walmart_order_lines(user_id, purchase_order_id);

create table if not exists public.walmart_sync_runs (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  status              text not null check (status in ('running','ok','error')),
  ordenes_upsert      integer not null default 0,
  lines_upsert        integer not null default 0,
  desde_iso           text,
  hasta_iso           text,
  error_mensaje       text,
  raw                 jsonb
);

-- RLS compartida (mismo patrón que falabella/sii)
alter table public.walmart_token_cache  enable row level security;
alter table public.walmart_orders       enable row level security;
alter table public.walmart_order_lines  enable row level security;
alter table public.walmart_sync_runs    enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['walmart_token_cache','walmart_orders','walmart_order_lines','walmart_sync_runs'])
  loop
    execute format('drop policy if exists "authed_select" on public.%I', t);
    execute format($p$create policy "authed_select" on public.%I for select to authenticated using (true)$p$, t);
  end loop;
end $$;

-- Vista de resumen mensual (mismo shape que falabella_resumen_mensual_v)
-- Estados en Walmart Chile: Created, Acknowledged (en alguna parte del ciclo
-- de vida puede haber: Shipped, Delivered, Cancelled — los excluimos del
-- net solo cuando Cancelled).
create or replace view public.walmart_resumen_mensual_v as
select
  user_id,
  to_char(order_date, 'YYYY-MM') as mes,
  count(*)                                                              as cantidad,
  count(*) filter (where lower(status) in ('delivered','shipped'))      as cant_entregadas,
  count(*) filter (where lower(status) in ('cancelled','canceled'))     as cant_canceladas,
  sum(total_amount)                                                     as total_bruto,
  sum(total_amount) filter (where lower(coalesce(status,'')) not in ('cancelled','canceled')) as total_neto,
  0::numeric(14,2)                                                      as total_voucher
from public.walmart_orders
group by user_id, to_char(order_date, 'YYYY-MM');

grant select on public.walmart_resumen_mensual_v to authenticated;
