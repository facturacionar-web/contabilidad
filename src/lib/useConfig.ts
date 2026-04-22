"use client";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { COUNTRIES, CURRENCIES } from "./countries";
import type { Config } from "./types";

export function useConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("config").select("*").maybeSingle();
    if (data) setConfig(data as Config);
    setReady(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const country = config ? COUNTRIES[config.pais] : COUNTRIES.MX;
  const currency = config ? CURRENCIES[config.moneda_base] : CURRENCIES.MXN;

  return { config, country, currency, ready, reload: load };
}

export async function saveConfig(patch: Partial<Config>): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");
  const { error } = await supabase
    .from("config")
    .upsert({ ...patch, user_id: user.id }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}
