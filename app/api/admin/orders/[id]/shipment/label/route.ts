import { requireAdmin } from "@/lib/server/auth";
import { errorResponse, rateLimit } from "@/lib/server/http";
import { shipmentLabel } from "@/lib/server/shipments";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAdmin(request.headers);
    await rateLimit(request, `shipment-label:${user.id}`, 20);
    const { id } = await context.params;
    const pdf = await shipmentLabel(id, user.id);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="etykieta-${id}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
