import { requireAdmin } from "@/lib/server/auth";
import { updateWithdrawal } from "@/lib/server/withdrawals";
import { requireSameOrigin, jsonBody, errorResponse } from "@/lib/server/http";
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const admin = await requireAdmin(request.headers);
    return Response.json(
      await updateWithdrawal(
        (await params).id,
        await jsonBody(request),
        admin.id,
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
