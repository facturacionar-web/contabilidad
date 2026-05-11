-- ============================================================
-- SII Chile - Tablas para integración con Registro Compras/Ventas
-- AISLADAS: prefijo sii_*. NO modifica tablas existentes.
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

-- 1. Resumen mensual por tipo de DTE
-- Cada fila es un (mes, tipo de documento) consolidado desde el SII.
-- El SII Chile no expone API para detalle factura-por-factura sin scraping
-- adicional. El resumen ya viene agregado por tipo de DTE en su API.
create table if not exists public.sii_resumen_mensual (
  user_id          uuid not null references auth.users(id) on delete cascade,
  rut_emisor       bigint not null,             -- RUT empresa chilena (sin DV)
  dv_emisor        text not null,               -- dígito verificador
  periodo          text not null,               -- 'YYYYMM'
  cod_tipo_doc     integer not null,            -- 33=FE, 39=BE, 41=BEEx, 43=Liq, 56=ND, 61=NC, etc.
  nombre_tipo_doc  text,
  cantidad         integer not null default 0,
  monto_exento     bigint not null default 0,
  monto_neto       bigint not null default 0,
  monto_iva        bigint not null default 0,
  monto_total      bigint not null default 0,
  raw              jsonb,                       -- respuesta completa del SII
  synced_at        timestamptz not null default now(),
  primary key (user_id, rut_emisor, periodo, cod_tipo_doc)
);
create index if not exists idx_sii_resumen_periodo
  on public.sii_resumen_mensual(user_id, periodo desc);

-- 2. Log de ejecuciones de sync (para auditoría / debugging)
create table if not exists public.sii_sync_runs (
  id                    bigint generated always as identity primary key,
  user_id               uuid not null references auth.users(id) on delete cascade,
  started_at            timestamptz not null default now(),
  finished_at           timestamptz,
  status                text not null check (status in ('running','ok','error')),
  periodos_sincronizados integer not null default 0,
  filas_actualizadas    integer not null default 0,
  error_mensaje         text,
  raw                   jsonb
);
create index if not exists idx_sii_sync_runs_user
  on public.sii_sync_runs(user_id, started_at desc);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.sii_resumen_mensual enable row level security;
alter table public.sii_sync_runs       enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['sii_resumen_mensual', 'sii_sync_runs'])
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
