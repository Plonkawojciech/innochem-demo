import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth";
import {
  errorResponse,
  jsonBody,
  requireSameOrigin,
  rateLimit,
} from "@/lib/server/http";
import {
  saveProduct,
  saveCategory,
  savePage,
  saveInquiry,
  saveSettings,
} from "@/lib/server/admin";
import { actOnOrder } from "@/lib/server/admin-orders";
import { StoreError } from "@/lib/server/orders";
import { saveSiteContent } from "@/lib/server/site-content";
import { query } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ resource: string; id?: string[] }> },
) {
  try {
    await requireAdmin(request.headers);
    const { resource, id } = await context.params;
    if (resource !== "media" || id?.length)
      throw new StoreError("NOT_FOUND", "Nie znaleziono zasobu.", 404);
    const params = new URL(request.url).searchParams,
      q = (params.get("q") || "").slice(0, 100),
      product = params.get("product") || null;
    if (product) z.uuid().parse(product);
    const page = Math.max(
      1,
      Math.min(10000, Math.floor(Number(params.get("page")) || 1)),
    );
    const { rows } = await query(
      "SELECT id,path,alt,mime_type,count(*) OVER()::int AS total FROM media WHERE ((NOT $5::boolean AND mime_type LIKE 'image/%') OR ($5::boolean AND mime_type IN ('application/pdf','application/msword','application/vnd.oasis.opendocument.text','application/vnd.openxmlformats-officedocument.wordprocessingml.document'))) AND ($4::boolean OR product_id IS NULL OR product_id=$1) AND (path ILIKE $2 OR alt ILIKE $2) ORDER BY created_at DESC,path LIMIT 24 OFFSET $3",
      [
        product,
        `%${q.replace(/[\\%_]/g, "\\$&")}%`,
        (page - 1) * 24,
        params.get("scope") === "site" || params.get("kind") === "document",
        params.get("kind") === "document",
      ],
    );
    return Response.json(
      { items: rows, total: rows[0]?.total || 0, page },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
async function mutate(
  request: Request,
  context: { params: Promise<{ resource: string; id?: string[] }> },
) {
  try {
    requireSameOrigin(request);
    const user = await requireAdmin(request.headers);
    await rateLimit(request, `admin:${user.id}`, 100);
    const { resource, id: segments } = await context.params;
    if (segments && segments.length !== 1)
      throw new StoreError("NOT_FOUND", "Nie znaleziono operacji.", 404);
    const id = segments?.[0];
    if (id) z.uuid().parse(id);
    if (
      request.method === "PUT" &&
      !id &&
      !["settings", "site"].includes(resource)
    )
      throw new StoreError("INVALID_REQUEST", "Brak identyfikatora.");
    if (request.method === "POST" && id && resource !== "orders")
      throw new StoreError("INVALID_REQUEST", "Nieprawidłowa operacja.");
    const body = await jsonBody(request, 240000);
    const result =
      resource === "products"
        ? await saveProduct(body, user.id, id)
        : resource === "categories"
          ? await saveCategory(body, user.id, id)
          : resource === "pages"
            ? await savePage(body, user.id, id)
            : resource === "inquiries" && id
              ? await saveInquiry(body, user.id, id)
              : resource === "orders" && id
                ? await actOnOrder(id, body, user.id)
                : resource === "site" && !id
                  ? await saveSiteContent(body, user.id)
                  : resource === "settings" && !id
                    ? await saveSettings(body, user.id)
                    : null;
    if (!result)
      throw new StoreError("NOT_FOUND", "Nie znaleziono operacji.", 404);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "23505"
    )
      return Response.json(
        {
          error: "Ten adres strony lub identyfikator jest już używany.",
          code: "DUPLICATE",
        },
        { status: 409 },
      );
    return errorResponse(error);
  }
}
export const POST = mutate;
export const PUT = mutate;
