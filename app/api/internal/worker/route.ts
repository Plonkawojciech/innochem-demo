import { workerAuthorized, runWorker } from "@/lib/server/worker";
import { errorResponse } from "@/lib/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!workerAuthorized(request))
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  try {
    return Response.json(await runWorker(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
