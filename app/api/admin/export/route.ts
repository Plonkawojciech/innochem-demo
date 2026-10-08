import { realpath } from "node:fs/promises";
import { requireAdmin } from "@/lib/server/auth";
import { errorResponse, rateLimit } from "@/lib/server/http";
import { transaction } from "@/lib/server/db";
import { audit } from "@/lib/server/admin";
import { StoreError } from "@/lib/server/orders";
import { fulfillmentExport, publicExportData } from "@/lib/server/export-data";
import { archiveMedia } from "@/lib/server/media-archive";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export async function GET(request: Request) {
  if (request.method === "HEAD") return HEAD(request);
  try {
    const user = await requireAdmin(request.headers);
    await rateLimit(request, `export:${user.id}`, 5);
    const format = new URL(request.url).searchParams.get("format") || "json";
    if (!["json", "products", "orders", "media"].includes(format))
      throw new StoreError("INVALID_FORMAT", "Nieznany format eksportu.");
    const headers = {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (format === "media") {
      if (request.signal.aborted)
        return new Response(null, { status: 499, headers });
      if (!process.env.MEDIA_ROOT)
        throw new StoreError(
          "MEDIA_UNAVAILABLE",
          "Nie skonfigurowano magazynu plików.",
          503,
        );
      const root = await realpath(process.env.MEDIA_ROOT);
      await transaction((db) => audit(db, user.id, "export.media", "store"));
      if (request.signal.aborted)
        return new Response(null, { status: 499, headers });
      return new Response(archiveMedia(root, request.signal), {
        headers: {
          ...headers,
          "Content-Type": "application/gzip",
          "Content-Disposition": 'attachment; filename="innochem-media.tar.gz"',
        },
      });
    }
    const tables = [
      "categories",
      "products",
      "product_categories",
      "product_documents",
      "media",
      "customers",
      "addresses",
      "orders",
      "order_items",
      "order_events",
      "shipments",
      "payment_sessions",
      "payment_webhook_events",
      "stock_movements",
      "price_history",
      "inquiries",
      "withdrawals",
      "pages",
      "legal_versions",
      "site_content",
      "site_revisions",
      "redirects",
      "settings",
      "legacy_records",
      "audit_log",
      "analytics_consents",
    ] as const;
    const data = await transaction(async (db) => {
      await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const result: Record<string, unknown[]> = {};
      for (const table of format === "json"
        ? tables
        : format === "products"
          ? ["products"]
          : ["orders"]) {
        const { rows } = await db.query(
          table === "orders" && format === "orders"
            ? `SELECT o.*, COALESCE((SELECT string_agg(i.sku || ' — ' || i.product_name || ' × ' || i.quantity::text, ' | ' ORDER BY i.id) FROM order_items i WHERE i.order_id=o.id),'') AS items FROM orders o ORDER BY o.created_at,o.id`
            : `SELECT * FROM ${table}`,
        );
        result[table] = rows.map((row) =>
          publicExportData(format === "orders" ? fulfillmentExport(row) : row),
        ) as Record<string, unknown>[];
      }
      await audit(db, user.id, `export.${format}`, "store");
      return result;
    });
    if (format === "json")
      return new Response(
        JSON.stringify(
          { formatVersion: 2, exportedAt: new Date().toISOString(), ...data },
          null,
          2,
        ),
        {
          headers: {
            ...headers,
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": 'attachment; filename="innochem-data.json"',
          },
        },
      );
    const rows = data[format] as Record<string, unknown>[];
    const columns =
      format === "products"
        ? [
            "id",
            "legacy_id",
            "sku",
            "name",
            "slug",
            "price_cents",
            "tax_rate",
            "stock",
            "reserved",
            "status",
            "sale_mode",
          ]
        : [
            "id",
            "number",
            "legacy_id",
            "email",
            "first_name",
            "last_name",
            "phone",
            "company",
            "nip",
            "street",
            "postal_code",
            "city",
            "country",
            "items",
            "cod_cents",
            "status",
            "currency",
            "total_cents",
            "shipping_cents",
            "payment_method",
            "shipping_label",
            "tracking_number",
            "created_at",
          ];
    const csv =
      "\uFEFF" +
      [
        columns.map(csvCell).join(";"),
        ...rows.map((row) =>
          columns
            .map((c) =>
              csvCell(
                row[c] instanceof Date
                  ? (row[c] as Date).toISOString()
                  : row[c],
              ),
            )
            .join(";"),
        ),
      ].join("\r\n");
    return new Response(csv, {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="innochem-${format}.csv"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Next otherwise invokes GET for HEAD without consuming its archive stream. */
export async function HEAD(request: Request) {
  try {
    await requireAdmin(request.headers);
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET", "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
