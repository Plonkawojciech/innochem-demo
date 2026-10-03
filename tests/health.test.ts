import test, { after } from "node:test";
import assert from "node:assert/strict";
import { database } from "../lib/server/db";
import { requiredMigrations } from "../lib/server/migrations-manifest";
import { GET } from "../app/api/health/route";
// Construct a pool only; every query is mocked and no connection is opened.
process.env.PGHOST = "synthetic-unused-host";
after(async () => database().end());
test("health requires every migration and returns only missing names", async (t) => {
  const missing: readonly string[] = [
    requiredMigrations[0],
    requiredMigrations[14],
  ];
  t.mock.method(database(), "query", async () => ({
    rows: requiredMigrations
      .filter((name) => !missing.includes(name))
      .map((name) => ({ name })),
  }));
  const response = await GET();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { missing });
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("health accepts a complete schema with store settings", async (t) => {
  t.mock.method(database(), "query", async (sql: string) =>
    sql.includes("schema_migrations")
      ? { rows: requiredMigrations.map((name) => ({ name })) }
      : { rowCount: 1 },
  );
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});
test("health does not expose database errors", async (t) => {
  t.mock.method(database(), "query", async () => {
    throw new Error("synthetic-private-database-error");
  });
  assert.deepEqual(await (await GET()).json(), { status: "unavailable" });
});
test("health rejects missing store settings", async (t) => {
  t.mock.method(database(), "query", async (sql: string) =>
    sql.includes("schema_migrations")
      ? { rows: requiredMigrations.map((name) => ({ name })) }
      : { rowCount: 0 },
  );
  assert.equal((await GET()).status, 503);
});
