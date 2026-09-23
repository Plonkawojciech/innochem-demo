import type { NextRequest } from "next/server";
import { ownedPaymentOrder } from "@/lib/server/payment-access";
import { refreshStripePayment } from "@/lib/server/stripe-payments";
import { requireSameOrigin, rateLimit, errorResponse } from "@/lib/server/http";
import { query } from "@/lib/server/db";
async function status(request: NextRequest, id: string) {
  const order = await ownedPaymentOrder(request, id);
  const payment = (
    await query("SELECT state FROM payment_sessions WHERE order_id=$1", [id])
  ).rows[0];
  return Response.json(
    { status: order.status, paymentState: payment?.state || null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return await status(request, (await params).id);
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    await ownedPaymentOrder(request, id);
    await rateLimit(request, `payment-refresh:${id}`, 6);
    await refreshStripePayment(id);
    return await status(request, id);
  } catch (error) {
    return errorResponse(error);
  }
}
