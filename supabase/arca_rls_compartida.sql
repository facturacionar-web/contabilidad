-- ============================================================
-- ARCA - Migración a RLS compartida por empresa
-- ============================================================
-- Los comprobantes ARCA son de la EMPRESA (un solo CUIT en env vars), no de
-- cada usuario individual. Cambiamos la RLS para que cualquier usuario
-- autenticado los vea, y solo el service-role pueda escribirlos.
--
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

-- 1. Borrar policies viejas (own_*) y crear policy de SELECT abierta a authenticated
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
    execute format('drop policy if exists "authed_select" on public.%I', t);

    -- SELECT: cualquier usuario autenticado (los datos son de la empresa).
    -- Sin policies de INSERT/UPDATE/DELETE → solo el service-role escribe.
    execute format(
      $p$create policy "authed_select" on public.%I for select to authenticated using (true)$p$,
      t
    );
  end loop;
end $$;

-- 2. Limpiar datos de usuarios que NO son CRON_USER_ID (Lucas)
-- (aparecieron porque el endpoint viejo guardaba con user_id de quien llamaba)
delete from public.arca_comprobantes_emitidos
  where user_id <> '7b19fa5f-5d64-41e1-9212-dfa5c8bd6d15';
delete from public.arca_sync_checkpoint
  where user_id <> '7b19fa5f-5d64-41e1-9212-dfa5c8bd6d15';
delete from public.arca_sync_runs
  where user_id <> '7b19fa5f-5d64-41e1-9212-dfa5c8bd6d15';
delete from public.arca_wsaa_cache
  where user_id <> '7b19fa5f-5d64-41e1-9212-dfa5c8bd6d15';
