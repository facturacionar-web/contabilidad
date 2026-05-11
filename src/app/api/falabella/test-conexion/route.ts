import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/arca/auth";
import { getOrders } from "@/lib/falabella/orders";
import { getCountry } from "@/lib/falabella/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  try {
    const hace30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, "+00:00");
    const orders = await getOrders({ createdAfter: hace30, limit: 5 });
    return NextResponse.json({
      ok: true,
      via: auth.via,
      pais: getCountry(),
      sampleCount: orders.length,
      sample: orders.map((o) => ({
        OrderId: o.OrderId,
        OrderNumber: o.OrderNumber,
        CreatedAt: o.CreatedAt,
        GrandTotal: o.GrandTotal,
        Status: o.Statuses?.Status,
      })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
