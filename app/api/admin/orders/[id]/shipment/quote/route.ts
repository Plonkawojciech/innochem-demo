import { requireAdmin } from "@/lib/server/auth";
import {
  errorResponse,
  jsonBody,
  rateLimit,
  requireSameOrigin,
} from "@/lib/server/http";
import { quoteShipment } from "@/lib/server/shipments";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const user = await requireAdmin(request.headers);
    await rateLimit(request, `shipment-quote:${user.id}`, 20);
    const { id } = await context.params;
    return Response.json(
      await quoteShipment(id, await jsonBody(request, 8000), user.id),
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
