"use client";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { COUNTRIES, CURRENCIES } from "./countries";
import type { Config } from "./types";

export function useConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [allConfigs, setAllConfigs] = useState<Config[]>([]);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("config").select("*");
    if (data && data.length > 0) {
      const rows = data as Config[];
      setAllConfigs(rows);
      const active = rows.find((c) => c.is_active) ?? rows[0];
      setConfig(active);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const country = config ? COUNTRIES[config.pais] : COUNTRIES.MX;
  const currency = config ? CURRENCIES[config.moneda_base] : CURRENCIES.MXN;

  return { config, allConfigs, country, currency, ready, reload: load };
}

export async function saveConfig(patch: Partial<Config> & { pais: string }): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");

  // Si se marca como activo, desactivar los demás primero
  if (patch.is_active) {
    await supabase
      .from("config")
      .update({ is_active: false })
      .eq("user_id", user.id);
  }

  const { error } = await supabase
    .from("config")
    .upsert({ ...patch, user_id: user.id }, { onConflict: "user_id,pais" });
  if (error) throw new Error(error.message);
}
