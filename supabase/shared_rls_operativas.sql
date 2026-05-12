-- ============================================================
-- RLS compartida para todas las tablas operativas
-- ============================================================
-- Antes: cada user solo veía/editaba sus propios registros (RLS por user_id).
-- Ahora: todos los usuarios autenticados de Alegrant tienen CRUD completo
-- sobre todos los datos. Los datos pertenecen a la empresa, no a cada user.
--
-- La gestión de usuarios sigue restringida al admin (`/api/admin/users` ya
-- chequea `user_metadata.owner_id` por código — no requiere policy a nivel DB).
-- ============================================================

do $$
declare t text;
begin
  for t in select unnest(array[
    'contactos',
    'gastos',
    'ingresos',
    'notas_credito',
    'pago_snapshot',
    'conceptos',
    'cuentas',
    'proveedor_config',
    'anticipos_aplicaciones',
    'conciliacion_movimientos',
    'config',
    'activity_log'
  ])
  loop
    -- Borrar policies viejas (varias variantes: own_*, "Users can ...")
    execute format('drop policy if exists "own_select" on public.%I', t);
    execute format('drop policy if exists "own_insert" on public.%I', t);
    execute format('drop policy if exists "own_update" on public.%I', t);
    execute format('drop policy if exists "own_delete" on public.%I', t);
    execute format('drop policy if exists "Users can select own %s" on public.%I', t, t);
    execute format('drop policy if exists "Users can insert own %s" on public.%I', t, t);
    execute format('drop policy if exists "Users can update own %s" on public.%I', t, t);
    execute format('drop policy if exists "Users can delete own %s" on public.%I', t, t);
    execute format('drop policy if exists "authed_select" on public.%I', t);
    execute format('drop policy if exists "authed_insert" on public.%I', t);
    execute format('drop policy if exists "authed_update" on public.%I', t);
    execute format('drop policy if exists "authed_delete" on public.%I', t);

    -- CRUD abierto a cualquier usuario autenticado de la app
    execute format($p$create policy "authed_select" on public.%I for select to authenticated using (true)$p$, t);
    execute format($p$create policy "authed_insert" on public.%I for insert to authenticated with check (true)$p$, t);
    execute format($p$create policy "authed_update" on public.%I for update to authenticated using (true) with check (true)$p$, t);
    execute format($p$create policy "authed_delete" on public.%I for delete to authenticated using (true)$p$, t);
  end loop;
end $$;
