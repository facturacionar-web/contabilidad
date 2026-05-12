-- ============================================================
-- SII + Falabella - Migración a RLS compartida por empresa
-- ============================================================
-- Mismo patrón que arca_rls_compartida.sql: los datos son de la EMPRESA
-- (RUT/credenciales en env vars), no de cada usuario. Cualquier user
-- autenticado lee. Solo service-role escribe (sync corre con admin client).
-- ============================================================

do $$
declare t text;
begin
  for t in select unnest(array[
    'sii_resumen_mensual',
    'sii_sync_runs',
    'sii_comprobantes_emitidos',
    'falabella_orders',
    'falabella_order_items',
    'falabella_sync_runs'
  ])
  loop
    execute format('drop policy if exists "own_select" on public.%I', t);
    execute format('drop policy if exists "own_insert" on public.%I', t);
    execute format('drop policy if exists "own_update" on public.%I', t);
    execute format('drop policy if exists "own_delete" on public.%I', t);
    execute format('drop policy if exists "authed_select" on public.%I', t);

    execute format(
      $p$create policy "authed_select" on public.%I for select to authenticated using (true)$p$,
      t
    );
  end loop;
end $$;
