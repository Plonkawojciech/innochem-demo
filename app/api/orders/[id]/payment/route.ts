import type { NextRequest } from "next/server";
import { ownedPaymentOrder } from "@/lib/server/payment-access";
import { startStripePayment } from "@/lib/server/stripe-payments";
import { requireSameOrigin, rateLimit, errorResponse } from "@/lib/server/http";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    await ownedPaymentOrder(request, id);
    await rateLimit(request, `payment:${id}`, 8);
    return Response.json(await startStripePayment(id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
