import { requireAdmin } from "@/lib/server/auth";
import {
  errorResponse,
  jsonBody,
  rateLimit,
  requireSameOrigin,
} from "@/lib/server/http";
import { createShipment, cancelShipment } from "@/lib/server/shipments";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const user = await requireAdmin(request.headers);
    await rateLimit(request, `shipment:${user.id}`, 10);
    const { id } = await context.params;
    return Response.json(
      await createShipment(id, await jsonBody(request, 8000), user.id),
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const user = await requireAdmin(request.headers);
    await rateLimit(request, `shipment:${user.id}`, 10);
    const { id } = await context.params;
    return Response.json(await cancelShipment(id, user.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
