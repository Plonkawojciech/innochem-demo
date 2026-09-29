import { NextResponse } from "next/server";
import { errorResponse, requireSameOrigin } from "@/lib/server/http";
/** Drops guest access cookies for orders and withdrawals; called on sign-out so a shared browser cannot reopen them. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const response = NextResponse.json({ ok: true });
    response.headers.set("Cache-Control", "no-store");
    const names = (request.headers.get("cookie") || "")
      .split(";")
      .map((x) => x.trim().split("=")[0])
      .filter((n) => /^innochem_(order|withdrawal)_/.test(n));
    for (const name of names)
      response.cookies.set(name, "", { path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
