-- ============================================================
-- SII Chile - Tabla de detalle: comprobantes emitidos (factura por factura)
-- ============================================================
create table if not exists public.sii_comprobantes_emitidos (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  rut_emisor    bigint not null,
  dv_emisor     text not null,
  periodo       text not null,             -- YYYYMM (detPcarga)
  cod_tipo_doc  integer not null,          -- 33, 39, 41, 43, 56, 61, etc.
  folio         bigint not null,           -- detNroDoc
  fecha_doc     date,                      -- detFchDoc
  rut_receptor  bigint,                    -- detRutDoc
  dv_receptor   text,                      -- detDvDoc
  razon_social_receptor text,              -- detRznSoc
  monto_exento  bigint not null default 0,
  monto_neto    bigint not null default 0,
  monto_iva     bigint not null default 0,
  monto_total   bigint not null default 0,
  tasa_imp      numeric(5,2),
  anulado       text,                      -- null si no anulado
  estado_contab text,                      -- REGISTRO, PENDIENTE, etc.
  desc_tipo_transaccion text,
  raw           jsonb,
  synced_at     timestamptz not null default now(),
  unique (user_id, rut_emisor, cod_tipo_doc, folio)
);

create index if not exists idx_sii_comprobantes_fecha
  on public.sii_comprobantes_emitidos(user_id, fecha_doc desc);
create index if not exists idx_sii_comprobantes_periodo
  on public.sii_comprobantes_emitidos(user_id, periodo desc, cod_tipo_doc);
create index if not exists idx_sii_comprobantes_receptor
  on public.sii_comprobantes_emitidos(user_id, rut_receptor);

-- RLS
alter table public.sii_comprobantes_emitidos enable row level security;

drop policy if exists "own_select" on public.sii_comprobantes_emitidos;
drop policy if exists "own_insert" on public.sii_comprobantes_emitidos;
drop policy if exists "own_update" on public.sii_comprobantes_emitidos;
drop policy if exists "own_delete" on public.sii_comprobantes_emitidos;

create policy "own_select" on public.sii_comprobantes_emitidos for select using ((select auth.uid()) = user_id);
create policy "own_insert" on public.sii_comprobantes_emitidos for insert with check ((select auth.uid()) = user_id);
create policy "own_update" on public.sii_comprobantes_emitidos for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own_delete" on public.sii_comprobantes_emitidos for delete using ((select auth.uid()) = user_id);
