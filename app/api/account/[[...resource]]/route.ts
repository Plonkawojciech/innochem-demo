import { customerForSession } from "@/lib/server/auth";
import {
  errorResponse,
  jsonBody,
  requireSameOrigin,
  rateLimit,
} from "@/lib/server/http";
import { saveAddress, saveProfile, archiveAddress } from "@/lib/server/account";
import { StoreError } from "@/lib/server/orders";
async function change(
  request: Request,
  context: { params: Promise<{ resource?: string[] }> },
) {
  try {
    requireSameOrigin(request);
    const customer = await customerForSession(request.headers);
    if (!customer) throw new Error("UNAUTHORIZED");
    await rateLimit(request, `account:${customer}`, 30);
    const body = await jsonBody(request);
    const parts = (await context.params).resource || [];
    let result;
    if (
      parts.length === 1 &&
      parts[0] === "profile" &&
      request.method === "PUT"
    )
      result = await saveProfile(customer, body);
    else if (
      parts.length === 1 &&
      parts[0] === "addresses" &&
      request.method === "POST"
    )
      result = await saveAddress(customer, body);
    else if (
      parts.length === 2 &&
      parts[0] === "addresses" &&
      request.method === "PUT"
    )
      result = await saveAddress(customer, body, parts[1]);
    else if (
      parts.length === 3 &&
      parts[0] === "addresses" &&
      parts[2] === "archive" &&
      request.method === "PUT"
    )
      result = await archiveAddress(customer, parts[1], body);
    else throw new StoreError("NOT_FOUND", "Nie znaleziono operacji.", 404);
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export const POST = change;
export const PUT = change;
