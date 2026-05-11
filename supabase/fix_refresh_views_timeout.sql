-- ============================================================
-- Fix: refresh de MVs pegaba contra el statement_timeout del
-- API gateway de Supabase cuando se llamaba vía PostgREST.
--
-- PostgREST tiene un statement_timeout fijo de ~8s para queries
-- REST API, independiente del role. La única forma de sortearlo
-- es declarar SET statement_timeout en la signatura de la función
-- (se aplica antes del body, sobreescribe el de PostgREST).
--
-- Cambios:
-- 1. Una función por MV → cada llamada PostgREST es independiente
--    y los tiempos no se suman.
-- 2. Sin CONCURRENTLY → para MVs chicas (5-10 filas) es más rápido.
-- 3. SET statement_timeout = '60s' por función → bypasa el límite
--    de PostgREST (medidas reales: 1.7-4.4s, holgado).
-- ============================================================

create or replace function public.refresh_arca_resumen_mensual()
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
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
set statement_timeout = '60s'
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
set statement_timeout = '60s'
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
