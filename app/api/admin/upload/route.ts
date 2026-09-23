import { requireAdmin } from "@/lib/server/auth";
import { errorResponse, requireSameOrigin, rateLimit } from "@/lib/server/http";
import { StoreError } from "@/lib/server/orders";
import { storeUpload } from "@/lib/server/uploads";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await requireAdmin(request.headers);
    await rateLimit(request, `upload:${user.id}`, 30);
    const reader = request.body?.getReader();
    if (!reader) throw new StoreError("EMPTY_UPLOAD", "Wybierz plik.");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 15 * 1024 * 1024) {
        await reader.cancel();
        throw new StoreError(
          "FILE_SIZE",
          "Maksymalna wielkość pliku wynosi 15 MB.",
          413,
        );
      }
      chunks.push(value);
    }
    const result = await storeUpload(Buffer.concat(chunks), user.id);
    return Response.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
