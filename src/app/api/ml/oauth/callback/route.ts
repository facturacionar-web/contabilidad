import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCodeForTokens, saveTokens } from "@/lib/ml/oauth";
import { getMe } from "@/lib/ml/orders";

export const dynamic = "force-dynamic";

/**
 * GET /api/ml/oauth/callback?code=...&state=...
 * Llamado por ML después de autorizar. Intercambia el code por tokens
 * y los persiste en ml_oauth_cache.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.json({ ok: false, error: `ML rechazó: ${error}` }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ ok: false, error: "falta code" }, { status: 400 });
  }

  // Verificar state contra la cookie httpOnly
  const cookieState = req.cookies.get("ml_oauth_state")?.value;
  if (!cookieState || cookieState !== state) {
    return NextResponse.json({ ok: false, error: "state inválido" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ ok: false, error: "no autenticado" }, { status: 401 });
  }

  // Los datos se guardan con CRON_USER_ID (la empresa), igual que ARCA
  const cronUserId = process.env.CRON_USER_ID;
  if (!cronUserId) {
    return NextResponse.json({ ok: false, error: "CRON_USER_ID no configurado" }, { status: 500 });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);

    // Confirmar el seller_id contra /users/me (a veces el user_id del token y el seller son distintos)
    const me = await getMe(tokens.accessToken);
    if (me.id && me.id !== tokens.mlUserId) {
      tokens.mlUserId = me.id;
    }

    const admin = createAdminClient();
    await saveTokens(admin, cronUserId, tokens, me.nickname);

    const target = url.origin + "/arca/resumen-mensual?ml_connected=1&seller=" + tokens.mlUserId;
    const redirect = NextResponse.redirect(target);
    redirect.cookies.set("ml_oauth_state", "", { maxAge: 0, path: "/" });
    return redirect;
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
