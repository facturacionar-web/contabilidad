import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/arca/auth";
import { getAccessToken, buildHeaders } from "@/lib/walmart/auth";
import { WALMART_BASE_URL } from "@/lib/walmart/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  try {
    const token = await getAccessToken(auth.supabase, auth.userId);
    const hace30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split(".")[0] + "Z";
    const ahora = new Date().toISOString().split(".")[0] + "Z";

    const url = new URL(`${WALMART_BASE_URL}/v3/orders`);
    url.searchParams.set("status", "Acknowledged");
    url.searchParams.set("createdStartDate", hace30);
    url.searchParams.set("createdEndDate", ahora);
    url.searchParams.set("limit", "3");

    const res = await fetch(url, { headers: buildHeaders(token) });
    const j = await res.json();
    const elements = j?.list?.elements?.order;
    const arr = Array.isArray(elements) ? elements : elements ? [elements] : [];
    return NextResponse.json({
      ok: true,
      via: auth.via,
      tokenPreview: token.slice(0, 20) + "...",
      sampleCount: arr.length,
      totalCount: j?.list?.meta?.totalCount ?? null,
      sample: arr.map((o: { purchaseOrderId: string; customerOrderId?: string; orderDate?: number }) => ({
        purchaseOrderId: o.purchaseOrderId,
        customerOrderId: o.customerOrderId,
        orderDate: o.orderDate ? new Date(o.orderDate).toISOString() : null,
      })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
