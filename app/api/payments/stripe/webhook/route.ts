import { rawBody, errorResponse } from "@/lib/server/http";
import {
  verifyStripeEvent,
  handleStripeEvent,
} from "@/lib/server/stripe-payments";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const event = verifyStripeEvent(
      await rawBody(request, 256000),
      request.headers.get("stripe-signature") || "",
    );
    await handleStripeEvent(event);
    return Response.json(
      { received: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
