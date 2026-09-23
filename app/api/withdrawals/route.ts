import { NextResponse } from "next/server";
import { createWithdrawal } from "@/lib/server/withdrawals";
import { customerForSession } from "@/lib/server/auth";
import {
  requireSameOrigin,
  rateLimit,
  jsonBody,
  errorResponse,
} from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await rateLimit(request, "withdrawal", 5);
    const result = await createWithdrawal(
      await jsonBody(request, 8000),
      await customerForSession(request.headers),
    );
    const { accessToken, ...data } = result;
    const response = NextResponse.json(data, {
      status: result.replayed ? 200 : 201,
      headers: { "Cache-Control": "private, no-store" },
    });
    response.cookies.set(`innochem_withdrawal_${result.id}`, accessToken, {
      httpOnly: true,
      secure: process.env.APP_URL?.startsWith("https:"),
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
    });
    return response;
  } catch (e) {
    return errorResponse(e);
  }
}
