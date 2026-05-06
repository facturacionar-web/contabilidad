"use client";
import { useEffect, useRef } from "react";
import { hydrateProveedoresFromCloud, migrateProveedoresToCloud } from "@/lib/proveedoresConfig";

const MIGRATED_FLAG = "alegrant.proveedores_cloud_migrated";

/**
 * Al montar (cuando entra el usuario), migra el localStorage a Supabase la primera vez,
 * y después hidrata el localStorage con los datos de Supabase.
 *
 * No renderiza nada visible.
 */
export default function ProveedoresConfigSync() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        const alreadyMigrated = localStorage.getItem(MIGRATED_FLAG);
        if (!alreadyMigrated) {
          // Primera vez: subir todo localStorage a la nube
          const r = await migrateProveedoresToCloud();
          if (r.configs > 0 || r.snapshots > 0) {
            console.log(`[proveedoresConfig] migrado a cloud: ${r.configs} configs, ${r.snapshots} snapshots`);
          }
          localStorage.setItem(MIGRATED_FLAG, "1");
        }
        // Cada vez: hidratar desde la nube (asegura ver cambios de otros usuarios del workspace)
        await hydrateProveedoresFromCloud();
      } catch (e) {
        console.warn("[ProveedoresConfigSync] error:", e);
      }
    })();
  }, []);

  return null;
}
