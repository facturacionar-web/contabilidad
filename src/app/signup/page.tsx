"use client";
import Link from "next/link";
import { Wallet, Lock } from "lucide-react";

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--background)]">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <Wallet className="w-7 h-7 text-[var(--primary)]" />
          <span className="text-xl font-semibold">Alegrant</span>
        </div>
        <div className="card text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
              <Lock className="w-6 h-6 text-slate-500" />
            </div>
          </div>
          <h1 className="text-lg font-semibold mb-2">Acceso restringido</h1>
          <p className="text-sm text-[var(--muted)] mb-5">
            No es posible crear cuentas nuevas. Contactá al administrador para que te cree un usuario.
          </p>
          <Link href="/login" className="btn btn-primary w-full">
            Ir al inicio de sesión
          </Link>
        </div>
      </div>
    </div>
  );
}
