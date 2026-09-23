import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth";
import { requireSameOrigin, jsonBody, errorResponse } from "@/lib/server/http";
import { cmsPreviewCookie } from "@/lib/server/site-content";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await requireAdmin(request.headers);
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(await jsonBody(request, 1000));
    const response = NextResponse.json(
      { enabled },
      { headers: { "Cache-Control": "private, no-store" } },
    );
    response.cookies.set(cmsPreviewCookie(), enabled ? "1" : "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.APP_URL?.startsWith("https://") || false,
      path: "/",
      maxAge: enabled ? 3600 : 0,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
