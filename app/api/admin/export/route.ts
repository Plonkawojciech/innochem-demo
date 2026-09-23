import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { realpath } from "node:fs/promises";
import { requireAdmin } from "@/lib/server/auth";
import { errorResponse, rateLimit } from "@/lib/server/http";
import { transaction } from "@/lib/server/db";
import { audit } from "@/lib/server/admin";
import { StoreError } from "@/lib/server/orders";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export async function GET(request: Request) {
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
      if (!process.env.MEDIA_ROOT)
        throw new StoreError(
          "MEDIA_UNAVAILABLE",
          "Nie skonfigurowano magazynu plików.",
          503,
        );
      const root = await realpath(process.env.MEDIA_ROOT);
      await transaction((db) => audit(db, user.id, "export.media", "store"));
      const processArchive = spawn("tar", ["-czf", "-", "-C", root, "."], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      // Bound stderr without exposing server paths in responses or logs.
      processArchive.stderr.resume();
      processArchive.once("error", () =>
        processArchive.stdout.destroy(new Error("Archive unavailable")),
      );
      processArchive.once("exit", (code) => {
        if (code !== 0)
          processArchive.stdout.destroy(new Error("Archive incomplete"));
      });
      request.signal.addEventListener("abort", () => processArchive.kill(), {
        once: true,
      });
      return new Response(
        Readable.toWeb(processArchive.stdout) as ReadableStream,
        {
          headers: {
            ...headers,
            "Content-Type": "application/gzip",
            "Content-Disposition":
              'attachment; filename="innochem-media.tar.gz"',
          },
        },
      );
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
    ] as const;
    const data = await transaction(async (db) => {
      await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const result: Record<string, unknown[]> = {};
      for (const table of format === "json"
        ? tables
        : format === "products"
          ? ["products"]
          : ["orders"]) {
        const { rows } = await db.query(`SELECT * FROM ${table}`);
        result[table] = rows.map((row) => {
          const {
            access_hash,
            idempotency_key,
            request_hash,
            request: paymentRequest,
            ...safe
          } = row;
          return safe;
        });
      }
      await audit(db, user.id, `export.${format}`, "store");
      return result;
    });
    if (format === "json")
      return new Response(
        JSON.stringify(
          { formatVersion: 1, exportedAt: new Date().toISOString(), ...data },
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
