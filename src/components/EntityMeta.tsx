"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { User, Pencil } from "lucide-react";

type LogEntry = {
  user_email: string | null;
  action: "create" | "update" | "delete" | "restore" | "purge";
  created_at: string;
};

type Props = {
  entity: string;          // "gastos", "ingresos", "notas_credito", "contactos", etc.
  entityId: string | number | undefined | null;
  className?: string;
  variant?: "inline" | "block";
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.round((now - then) / 1000);
  if (diff < 60) return "hace un momento";
  if (diff < 3600) return `hace ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.round(diff / 3600)} h`;
  if (diff < 86400 * 7) return `hace ${Math.round(diff / 86400)} días`;
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

function emailLabel(email: string | null): string {
  if (!email) return "—";
  // Mostrar solo la parte antes del @ para no ocupar tanto espacio
  return email.split("@")[0];
}

export default function EntityMeta({ entity, entityId, className = "", variant = "inline" }: Props) {
  const [creator, setCreator] = useState<LogEntry | null>(null);
  const [lastEdit, setLastEdit] = useState<LogEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!entityId) { setLoading(false); return; }
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      // Primer evento (create) y último update
      const { data } = await supabase
        .from("activity_log")
        .select("user_email,action,created_at")
        .eq("entity", entity)
        .eq("entity_id", String(entityId))
        .order("created_at", { ascending: true })
        .limit(50);
      if (cancelled) return;
      const rows = (data ?? []) as LogEntry[];
      const create = rows.find(r => r.action === "create") ?? rows[0] ?? null;
      const lastUpd = [...rows].reverse().find(r => r.action === "update") ?? null;
      setCreator(create);
      setLastEdit(lastUpd);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [entity, entityId]);

  if (loading || !creator) return null;

  if (variant === "block") {
    return (
      <div className={`text-xs text-[var(--muted)] space-y-0.5 ${className}`}>
        <p className="flex items-center gap-1.5">
          <User className="w-3 h-3" />
          Creado por <span className="font-medium text-[var(--foreground)]">{emailLabel(creator.user_email)}</span>
          <span>· {relativeTime(creator.created_at)}</span>
        </p>
        {lastEdit && lastEdit.created_at !== creator.created_at && (
          <p className="flex items-center gap-1.5">
            <Pencil className="w-3 h-3" />
            Editado por <span className="font-medium text-[var(--foreground)]">{emailLabel(lastEdit.user_email)}</span>
            <span>· {relativeTime(lastEdit.created_at)}</span>
          </p>
        )}
      </div>
    );
  }

  // variant === "inline"
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] text-[var(--muted)] ${className}`}
      title={`Creado por ${creator.user_email ?? "—"} el ${new Date(creator.created_at).toLocaleString("es-AR")}${lastEdit ? `\nEditado por ${lastEdit.user_email ?? "—"} el ${new Date(lastEdit.created_at).toLocaleString("es-AR")}` : ""}`}
    >
      <User className="w-3 h-3" />
      <span>{emailLabel(creator.user_email)}</span>
      {lastEdit && lastEdit.created_at !== creator.created_at && (
        <>
          <Pencil className="w-3 h-3 ml-1" />
          <span>{emailLabel(lastEdit.user_email)}</span>
        </>
      )}
    </span>
  );
}
