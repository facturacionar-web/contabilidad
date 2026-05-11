-- ============================================================
-- Fix: refresh de MVs pegaba contra el statement_timeout del
-- API gateway de Supabase (~10s) cuando las 3 corrían juntas
-- con CONCURRENTLY (~14s en total).
--
-- Cambios:
-- 1. Una función por MV → cada llamada PostgREST es independiente
--    (su propio timeout) y nunca se suman.
-- 2. Sin CONCURRENTLY → para MVs chicas (5-10 filas) es más rápido.
--    CONCURRENTLY solo paga la pena si hay lectores concurrentes
--    intolerantes a un lock corto, que no es el caso acá.
-- ============================================================

create or replace function public.refresh_arca_resumen_mensual()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view public.arca_resumen_mensual_v;
end;
$$;

create or replace function public.refresh_ml_resumen_mensual()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view public.ml_resumen_mensual_v;
end;
$$;

create or replace function public.refresh_ml_resumen_mensual_seller()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view public.ml_resumen_mensual_seller_v;
end;
$$;

grant execute on function public.refresh_arca_resumen_mensual()       to authenticated, service_role;
grant execute on function public.refresh_ml_resumen_mensual()         to authenticated, service_role;
grant execute on function public.refresh_ml_resumen_mensual_seller()  to authenticated, service_role;

-- Mantenemos refresh_resumen_views por compatibilidad pero ahora
-- sin CONCURRENTLY. Se sigue usando desde /api/admin/refresh-views,
-- aunque el endpoint también pasa a llamar las 3 individuales.
create or replace function public.refresh_resumen_views()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view public.arca_resumen_mensual_v;
  refresh materialized view public.ml_resumen_mensual_v;
  refresh materialized view public.ml_resumen_mensual_seller_v;
end;
$$;
