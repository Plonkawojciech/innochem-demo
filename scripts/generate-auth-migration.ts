import { getMigrations } from "better-auth/db/migration";
import { writeFile } from "node:fs/promises";
import { authOptions } from "../lib/server/auth";
import { database } from "../lib/server/db";
async function main() {
  const plan = await getMigrations(authOptions());
  if (plan.unsafeChanges.length || plan.schemaProblems.length)
    throw new Error("Unsafe authentication schema change");
  const sql = await plan.compileMigrations();
  await writeFile("db/migrations/002_auth.sql", sql, { flag: "wx" });
  console.log("Authentication migration generated; review before applying.");
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => database().end());
