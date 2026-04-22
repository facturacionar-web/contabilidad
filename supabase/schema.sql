-- Contabilidad: schema + Row Level Security (individual per-user isolation)
-- Ejecutar este archivo en: Supabase Dashboard → SQL Editor → New query → pegar → Run

-- =========================================================
-- 1. Tablas
-- =========================================================

-- Configuración por usuario (1 fila por usuario)
create table if not exists public.config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pais text not null default 'MX',
  moneda_base text not null default 'MXN',
  empresa_nombre text not null default 'Mi Empresa',
  empresa_tax_id text,
  empresa_email text,
  empresa_telefono text,
  empresa_direccion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Contactos (clientes / proveedores)
create table if not exists public.contactos (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('cliente','proveedor','ambos')),
  nombre text not null,
  tax_id text,
  email text,
  telefono text,
  direccion text,
  pais text,
  notas text,
  created_at timestamptz not null default now()
);
create index if not exists idx_contactos_user on public.contactos(user_id);
create index if not exists idx_contactos_nombre on public.contactos(user_id, nombre);

-- Ingresos
create table if not exists public.ingresos (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  fecha date not null,
  tipo text not null check (tipo in ('ingreso_dinero','otro_ingreso')),
  contacto_id bigint references public.contactos(id) on delete set null,
  concepto text not null,
  categoria text not null,
  monto numeric(14,2) not null check (monto >= 0),
  moneda text not null,
  metodo_pago text not null,
  referencia text,
  notas text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ingresos_user_fecha on public.ingresos(user_id, fecha desc);

-- Gastos / Facturas de proveedor
create table if not exists public.gastos (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  fecha date not null,
  fecha_vencimiento date,
  tipo text not null check (tipo in ('gasto','factura_proveedor')),
  contacto_id bigint references public.contactos(id) on delete set null,
  numero_factura text,
  concepto text not null,
  categoria text not null,
  subtotal numeric(14,2) not null check (subtotal >= 0),
  iva numeric(6,2) not null default 0,
  iva_monto numeric(14,2) not null default 0,
  total numeric(14,2) not null,
  moneda text not null,
  estado text not null check (estado in ('pagado','pendiente','parcial')),
  metodo_pago text,
  monto_pagado numeric(14,2) not null default 0,
  notas text,
  created_at timestamptz not null default now()
);
create index if not exists idx_gastos_user_fecha on public.gastos(user_id, fecha desc);
create index if not exists idx_gastos_estado on public.gastos(user_id, estado);

-- Notas de crédito
create table if not exists public.notas_credito (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  fecha date not null,
  tipo text not null check (tipo in ('emitida','recibida')),
  contacto_id bigint references public.contactos(id) on delete set null,
  numero text,
  gasto_relacionado_id bigint references public.gastos(id) on delete set null,
  concepto text not null,
  monto numeric(14,2) not null check (monto >= 0),
  moneda text not null,
  motivo text not null,
  notas text,
  created_at timestamptz not null default now()
);
create index if not exists idx_notas_user_fecha on public.notas_credito(user_id, fecha desc);

-- =========================================================
-- 2. Row Level Security — cada usuario solo ve sus propios datos
-- =========================================================

alter table public.config enable row level security;
alter table public.contactos enable row level security;
alter table public.ingresos enable row level security;
alter table public.gastos enable row level security;
alter table public.notas_credito enable row level security;

-- Policy helper: (select auth.uid()) = user_id
-- Las creamos para SELECT/INSERT/UPDATE/DELETE en cada tabla

do $$
declare t text;
begin
  for t in select unnest(array['config','contactos','ingresos','gastos','notas_credito'])
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

-- =========================================================
-- 3. Trigger: crear config por defecto al registrarse
-- =========================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.config (user_id, pais, moneda_base, empresa_nombre)
  values (new.id, 'MX', 'MXN', 'Mi Empresa')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
