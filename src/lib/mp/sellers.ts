import type { SupabaseClient } from "@supabase/supabase-js";

export type MpSeller = {
  cuentaId: string;       // public.cuentas.id (uuid)
  cuentaNombre: string;   // ej "Mercado Pago" / "Mercado Pago DS"
  mpUserId: number;       // seller_id en MP/ML
};

/**
 * Lista todas las cuentas MP configuradas en `public.cuentas` con `mp_user_id`
 * seteado. Cada una corresponde a un seller MP autorizado vía OAuth (mismo
 * patrón que ML — el access_token vive en ml_oauth_cache).
 */
export async function listMpSellers(
  supabase: SupabaseClient,
  userId: string,
): Promise<MpSeller[]> {
  const { data, error } = await supabase
    .from("cuentas")
    .select("id, nombre, mp_user_id")
    .eq("user_id", userId)
    .not("mp_user_id", "is", null)
    .is("deleted_at", null)
    .order("nombre");
  if (error) throw new Error(`listMpSellers: ${error.message}`);
  return (data ?? []).map((row) => ({
    cuentaId: row.id as string,
    cuentaNombre: row.nombre as string,
    mpUserId: Number(row.mp_user_id),
  }));
}
