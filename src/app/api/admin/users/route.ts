import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabase } from "@supabase/supabase-js";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY no configurada en las variables de entorno del servidor.");
  return createSupabase(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw Object.assign(new Error("No autenticado"), { status: 401 });
  if (user.user_metadata?.owner_id) throw Object.assign(new Error("Solo el administrador puede gestionar usuarios"), { status: 403 });
  return user;
}

export async function GET() {
  try {
    const user = await requireAdmin();
    const admin = adminClient();
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw new Error(error.message);
    const subUsers = data.users
      .filter(u => u.user_metadata?.owner_id === user.id)
      .map(u => ({ id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at }));
    return NextResponse.json({ users: subUsers });
  } catch (err) {
    const e = err as Error & { status?: number };
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
    const { email, password } = await req.json();
    if (!email || !password) return NextResponse.json({ error: "Email y contraseña son requeridos" }, { status: 400 });
    if (password.length < 6) return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres" }, { status: 400 });
    const admin = adminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { owner_id: user.id },
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ user: { id: data.user.id, email: data.user.email, created_at: data.user.created_at } });
  } catch (err) {
    const e = err as Error & { status?: number };
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireAdmin();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    const admin = adminClient();
    const { data: { user: target }, error: fetchErr } = await admin.auth.admin.getUserById(id);
    if (fetchErr || !target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    if (target.user_metadata?.owner_id !== user.id) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = err as Error & { status?: number };
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAdmin();
    const { id, password } = await req.json();
    if (!id || !password) return NextResponse.json({ error: "ID y contraseña requeridos" }, { status: 400 });
    const admin = adminClient();
    const { data: { user: target }, error: fetchErr } = await admin.auth.admin.getUserById(id);
    if (fetchErr || !target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    if (target.user_metadata?.owner_id !== user.id) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = err as Error & { status?: number };
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
