import { query } from "@/lib/server/db";
import { requiredMigrations } from "@/lib/server/migrations-manifest";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const applied = await query<{ name: string }>(
      "SELECT name FROM schema_migrations",
    );
    const names = new Set(applied.rows.map((row) => row.name));
    const missing = requiredMigrations.filter((name) => !names.has(name));
    if (missing.length)
      return Response.json(
        { missing },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    const result = await query("SELECT 1 FROM settings WHERE key='store'");
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
