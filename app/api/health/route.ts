import { query } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const result = await query(
      "SELECT 1 FROM settings WHERE key='store' AND EXISTS(SELECT 1 FROM schema_migrations WHERE name='013_withdrawals.sql')",
    );
    if (result.rowCount !== 1) throw new Error("Schema is not ready");
    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
