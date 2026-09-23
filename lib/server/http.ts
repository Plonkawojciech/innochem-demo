import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { query } from "./db";
import { StoreError } from "./orders";
export function requireSameOrigin(request: Request) {
  if (
    !process.env.APP_URL ||
    request.headers.get("origin") !== new URL(process.env.APP_URL).origin
  )
    throw new StoreError(
      "ORIGIN_REJECTED",
      "Odśwież stronę i spróbuj ponownie.",
      403,
    );
}
export async function rawBody(request: Request, maxBytes = 32000) {
  const reader = request.body?.getReader();
  if (!reader)
    throw new StoreError("INVALID_REQUEST", "Brak danych formularza.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new StoreError(
        "REQUEST_TOO_LARGE",
        "Formularz jest zbyt duży.",
        413,
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function jsonBody(request: Request, maxBytes = 32000) {
  const raw = await rawBody(request, maxBytes);
  try {
    return JSON.parse(raw);
  } catch {
    throw new StoreError("INVALID_REQUEST", "Nieprawidłowy format danych.");
  }
}
export async function rateLimit(request: Request, bucket: string, limit = 20) {
  const forwarded = request.headers.get("x-real-ip") || "";
  const ip =
    process.env.TRUST_PROXY === "true" && isIP(forwarded) ? forwarded : "local";
  const key = createHash("sha256").update(`${bucket}:${ip}`).digest("hex");
  const { rows } = await query(
    `INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.hits+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN now()+interval '1 minute' ELSE rate_limits.expires_at END RETURNING hits`,
    [key],
  );
  if (rows[0].hits > limit)
    throw new StoreError("RATE_LIMIT", "Za dużo prób. Odczekaj minutę.", 429);
}
export function errorResponse(error: unknown) {
  if (error instanceof ZodError)
    return Response.json(
      {
        error: "Sprawdź poprawność wszystkich pól formularza.",
        code: "VALIDATION",
        fields: error.issues.map((i) => i.path.join(".")),
      },
      { status: 400 },
    );
  if (error instanceof StoreError)
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  if (
    error instanceof Error &&
    ["UNAUTHORIZED", "FORBIDDEN"].includes(error.message)
  )
    return Response.json(
      { error: "Brak uprawnień." },
      { status: error.message === "UNAUTHORIZED" ? 401 : 403 },
    );
  console.error(
    "Store request failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return Response.json(
    {
      error: "Nie udało się wykonać operacji. Spróbuj ponownie.",
      code: "INTERNAL",
    },
    { status: 500 },
  );
}
