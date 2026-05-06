-- ============================================================
-- ARCA - Tablas para integración con Webservices ARCA (ex AFIP)
-- AISLADAS: prefijo arca_*. NO modifica tablas existentes.
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

-- 1. Cache del Token+Sign de WSAA (válido 12hs por servicio)
create table if not exists public.arca_wsaa_cache (
  user_id     uuid not null references auth.users(id) on delete cascade,
  service     text not null,                                -- 'wsfe', 'ws_sr_padron_a13', etc.
  token       text not null,
  sign        text not null,
  expira_at   timestamptz not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, service)
);

-- 2. Checkpoint por (PtoVta, TipoCbte) para sync incremental
create table if not exists public.arca_sync_checkpoint (
  user_id                  uuid not null references auth.users(id) on delete cascade,
  pto_vta                  integer not null,
  cbte_tipo                integer not null,
  ultimo_nro_sincronizado  integer not null default 0,
  updated_at               timestamptz not null default now(),
  primary key (user_id, pto_vta, cbte_tipo)
);

-- 3. Comprobantes emitidos sincronizados desde ARCA
create table if not exists public.arca_comprobantes_emitidos (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  cuit_emisor   bigint not null,
  pto_vta       integer not null,
  cbte_tipo     integer not null,            -- 1=FacA, 6=FacB, 11=FacC, 3=NCa A, 8=NCa B, etc.
  cbte_nro      integer not null,
  fecha_cbte    date not null,
  doc_tipo      integer,                     -- 80=CUIT, 86=CUIL, 96=DNI, 99=Cons.Final
  doc_nro       bigint,
  imp_total     numeric(14,2) not null,
  imp_tot_conc  numeric(14,2),               -- importes no gravados
  imp_neto      numeric(14,2),
  imp_op_ex     numeric(14,2),               -- exentos
  imp_iva       numeric(14,2),
  imp_trib      numeric(14,2),
  mon_id        text,                        -- PES, DOL, etc.
  mon_cotiz     numeric(14,6),
  cae           text not null,
  cae_vto       date,
  resultado     text,                        -- A=Aprobado, R=Rechazado, P=Parcial
  raw           jsonb,                       -- respuesta completa por si falta algún campo
  synced_at     timestamptz not null default now(),
  unique (user_id, pto_vta, cbte_tipo, cbte_nro)
);
create index if not exists idx_arca_cbte_user_fecha
  on public.arca_comprobantes_emitidos(user_id, fecha_cbte desc);
create index if not exists idx_arca_cbte_doc_nro
  on public.arca_comprobantes_emitidos(user_id, doc_nro);

-- 4. Log de ejecuciones de sync (para auditoría / debugging)
create table if not exists public.arca_sync_runs (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null check (status in ('running','ok','error')),
  comprobantes_nuevos integer not null default 0,
  error_mensaje   text,
  raw             jsonb
);
create index if not exists idx_arca_sync_runs_user
  on public.arca_sync_runs(user_id, started_at desc);

-- ============================================================
-- Row Level Security: cada usuario solo ve sus propios datos
-- ============================================================

alter table public.arca_wsaa_cache             enable row level security;
alter table public.arca_sync_checkpoint        enable row level security;
alter table public.arca_comprobantes_emitidos  enable row level security;
alter table public.arca_sync_runs              enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array[
    'arca_wsaa_cache',
    'arca_sync_checkpoint',
    'arca_comprobantes_emitidos',
    'arca_sync_runs'
  ])
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
