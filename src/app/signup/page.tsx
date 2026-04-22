"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Wallet } from "lucide-react";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/auth/callback`
            : undefined,
      },
    });
    setLoading(false);
    if (error) {
      setError(traducirError(error.message));
      return;
    }
    if (data.session) {
      router.push("/");
      router.refresh();
    } else {
      setInfo(
        "Te enviamos un email de confirmación. Revisá tu bandeja para activar la cuenta."
      );
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--background)]">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <Wallet className="w-7 h-7 text-[var(--primary)]" />
          <span className="text-xl font-semibold">Contabilidad</span>
        </div>
        <div className="card">
          <h1 className="text-xl font-semibold mb-1">Crear cuenta</h1>
          <p className="text-sm text-[var(--muted)] mb-5">
            Gratis. Tus datos quedan aislados de otros usuarios.
          </p>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="label">Contraseña (mín. 6 caracteres)</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {error}
              </p>
            )}
            {info && (
              <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
                {info}
              </p>
            )}
            <button
              className="btn btn-primary w-full"
              type="submit"
              disabled={loading}
            >
              {loading ? "Creando cuenta…" : "Crear cuenta"}
            </button>
          </form>
        </div>
        <p className="text-sm text-center text-[var(--muted)] mt-6">
          ¿Ya tenés cuenta?{" "}
          <Link href="/login" className="text-[var(--primary)] font-medium hover:underline">
            Ingresá
          </Link>
        </p>
      </div>
    </div>
  );
}

function traducirError(msg: string): string {
  if (msg.includes("User already registered")) return "Ese email ya tiene una cuenta.";
  if (msg.toLowerCase().includes("password")) return "La contraseña no cumple los requisitos (mín. 6 caracteres).";
  return msg;
}
