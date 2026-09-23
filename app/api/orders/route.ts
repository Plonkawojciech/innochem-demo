import { NextResponse } from "next/server";
import { createOrder } from "@/lib/server/orders";
import { customerForSession } from "@/lib/server/auth";
import {
  requireSameOrigin,
  jsonBody,
  rateLimit,
  errorResponse,
} from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await rateLimit(request, "checkout", 10);
    const result = await createOrder(
      await jsonBody(request),
      await customerForSession(request.headers),
    );
    const response = NextResponse.json(
      { id: result.id, number: result.number, url: `/zamowienie/${result.id}` },
      { status: result.replayed ? 200 : 201 },
    );
    response.cookies.set(`innochem_order_${result.id}`, result.accessToken, {
      httpOnly: true,
      secure: process.env.APP_URL?.startsWith("https:"),
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
