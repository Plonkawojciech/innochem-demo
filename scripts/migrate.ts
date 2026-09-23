import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { database } from "../lib/server/db";

async function main() {
  const client = await database().connect();
  try {
    await client.query("SELECT pg_advisory_lock(842615912)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir("db/migrations"))
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(`db/migrations/${name}`, "utf8");
      const hash = createHash("sha256").update(sql).digest("hex");
      const previous = await client.query(
        "SELECT checksum FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (previous.rowCount) {
        if (previous.rows[0].checksum !== hash)
          throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
          [name, hash],
        );
        await client.query("COMMIT");
        console.log(`Applied ${name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(842615912)");
    client.release();
    await database().end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Migration failed");
  process.exitCode = 1;
});
