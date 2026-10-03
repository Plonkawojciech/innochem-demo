import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { requiredMigrations } from "../lib/server/migrations-manifest";
test("release migration manifest matches every SQL migration exactly", async () => {
  const files = (await readdir(new URL("../db/migrations/", import.meta.url)))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.deepEqual([...requiredMigrations], files);
});
