import { NextResponse } from "next/server";
import { z } from "zod";
import {
  consentCookie,
  consentId,
  revokeConsent,
} from "@/lib/server/analytics";
import { query } from "@/lib/server/db";
import {
  errorResponse,
  jsonBody,
  requireSameOrigin,
  rateLimit,
} from "@/lib/server/http";
const input = z
  .object({ analytics: z.boolean(), v: z.literal(1), at: z.iso.datetime() })
  .strict();
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const decision = input.parse(await jsonBody(request, 1024));
    await rateLimit(request, "analytics-consent", decision.analytics ? 30 : 60);
    const old = consentId(request);
    if (old) await revokeConsent(old);
    const response = NextResponse.json({ ok: true });
    response.headers.set("Cache-Control", "no-store");
    if (
      decision.analytics &&
      process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID?.trim()
    ) {
      const at = new Date(decision.at);
      if (Math.abs(Date.now() - at.getTime()) > 300000)
        return NextResponse.json(
          { error: "Invalid consent time" },
          { status: 400 },
        );
      const {
        rows: [c],
      } = await query(
        "INSERT INTO analytics_consents(granted_at,expires_at) VALUES($1,$1::timestamptz+interval '6 months') RETURNING id",
        [at],
      );
      response.cookies.set(consentCookie, c.id, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.APP_URL?.startsWith("https:"),
        path: "/",
        maxAge: 60 * 60 * 24 * 366,
      });
    } else response.cookies.set(consentCookie, "", { path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
