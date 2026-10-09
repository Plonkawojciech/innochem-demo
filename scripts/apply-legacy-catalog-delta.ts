import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LegacyDeltaInputError } from "../lib/legacy-delta";
import {
  applyLegacyCatalogDelta,
  dryRunLegacyCatalogDelta,
} from "../lib/legacy-delta-apply";
import { requiredMigrations } from "../lib/server/migrations-manifest";

const maxBytes = 16 * 1024 * 1024;
async function readPrivateJson(filename: string) {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes || (info.mode & 0o077) !== 0)
      throw new LegacyDeltaInputError();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.alloc(64 * 1024);
      const { bytesRead } = await file.read(chunk);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) throw new LegacyDeltaInputError();
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const buffer = Buffer.concat(chunks);
    try {
      return JSON.parse(buffer.toString("utf8")) as unknown;
    } catch {
      throw new LegacyDeltaInputError();
    }
  } finally {
    await file.close();
  }
}
async function writeExclusive(filename: string, value: unknown) {
  const buffer = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  if (buffer.length > maxBytes) throw new LegacyDeltaInputError();
  const file = await open(
    filename,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(buffer);
    await file.sync();
  } finally {
    await file.close();
  }
}
export function legacyCatalogDeltaEnvironment(
  env: NodeJS.ProcessEnv,
  database: string,
  apply: boolean,
) {
  if (
    !/^innochem(?:_[a-z0-9_]+)?$/.test(database) ||
    env.PGDATABASE !== database ||
    !env.PGHOST ||
    !env.PGUSER ||
    env.PGOPTIONS ||
    (env.PGPORT &&
      (!/^[0-9]+$/.test(env.PGPORT) ||
        Number(env.PGPORT) < 1 ||
        Number(env.PGPORT) > 65535))
  )
    throw new LegacyDeltaInputError();
  if (
    apply
      ? env.INNOCHEM_DELTA_CATALOG_APPLY !== "1" ||
        env.INNOCHEM_DELTA_FREEZE_CONFIRMED !== "1" ||
        env.PAYMENTS_ENABLED !== "false" ||
        env.MAIL_DELIVERY_ENABLED !== "false" ||
        env.STORE_WORKER_ENABLED !== "false"
      : env.INNOCHEM_DELTA_EXPORT_READ_ONLY !== "1"
  )
    throw new LegacyDeltaInputError();
  return { explicitDatabaseConfirmed: true, apply };
}
function options(args: string[]) {
  const apply = args.includes("--apply");
  const required = [
    "--baseline",
    "--final",
    "--target",
    "--provenance",
    "--database",
    ...(apply ? ["--plan", "--confirm-plan-hash"] : ["--output"]),
  ];
  if (args.filter((arg) => arg === "--apply").length > 1)
    throw new LegacyDeltaInputError();
  const rest = args.filter((arg) => arg !== "--apply"),
    values = new Map<string, string>();
  if (rest.length !== required.length * 2) throw new LegacyDeltaInputError();
  for (let index = 0; index < rest.length; index += 2) {
    if (
      !required.includes(rest[index]) ||
      values.has(rest[index]) ||
      !rest[index + 1] ||
      rest[index + 1].startsWith("--")
    )
      throw new LegacyDeltaInputError();
    values.set(
      rest[index],
      ["--database", "--confirm-plan-hash"].includes(rest[index])
        ? rest[index + 1]
        : path.resolve(rest[index + 1]),
    );
  }
  if (required.some((key) => !values.has(key)))
    throw new LegacyDeltaInputError();
  return { apply, values };
}
export async function legacyCatalogDeltaCommand(args: string[]) {
  const { apply, values } = options(args),
    database = values.get("--database")!;
  legacyCatalogDeltaEnvironment(process.env, database, apply);
  const filenames = [
    "--baseline",
    "--final",
    "--target",
    "--provenance",
    ...(apply ? ["--plan"] : []),
  ].map((key) => values.get(key)!);
  const realInputs = await Promise.all(
    filenames.map((filename) => realpath(filename)),
  );
  if (
    new Set(realInputs).size !== filenames.length ||
    (!apply && filenames.includes(values.get("--output")!))
  )
    throw new LegacyDeltaInputError();
  const [baseline, final, target, provenance, plan] = await Promise.all(
    filenames.map(readPrivateJson),
  );
  const inputs = { baseline, final, target, provenance };
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const expectedMigrations = await Promise.all(
    requiredMigrations.map(async (name) => ({
      name,
      checksum: createHash("sha256")
        .update(await readFile(path.join(repo, "db/migrations", name)))
        .digest("hex"),
    })),
  );
  const { Client } = await import("pg");
  const client = new Client({
    application_name: "innochem-legacy-catalog-delta",
    connectionTimeoutMillis: 5000,
  });
  let disconnected = false;
  client.on("error", () => {
    disconnected = true;
  });
  try {
    await client.connect();
    const dedicated = {
      dedicatedConnection: true as const,
      query: (sql: string, params?: unknown[]) => client.query(sql, params),
    };
    const binding = { database, expectedMigrations };
    if (apply) {
      const result = await applyLegacyCatalogDelta(dedicated, inputs, plan, {
        ...binding,
        confirmPlanHash: values.get("--confirm-plan-hash")!,
      });
      if (disconnected) throw new LegacyDeltaInputError();
      return result;
    }
    const result = await dryRunLegacyCatalogDelta(dedicated, inputs, binding);
    if (disconnected) throw new LegacyDeltaInputError();
    await writeExclusive(values.get("--output")!, result);
    return {
      written: true,
      readOnly: true,
      operations: result.operations.length,
      blockers: result.blockers.length,
      applyAllowed: result.applyAllowed,
      planHash: result.planHash,
    };
  } finally {
    await client.end();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  legacyCatalogDeltaCommand(process.argv.slice(2))
    .then((summary) => console.log(JSON.stringify(summary)))
    .catch(() => {
      console.error(
        "Legacy catalog delta failed; check the private plan, provenance, schema, freeze guards and database locally",
      );
      process.exitCode = 1;
    });
}
