import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareLegacyDelta,
  exportLegacyDeltaTarget,
  normalizeLegacyDeltaSource,
  LegacyDeltaInputError,
} from "../lib/legacy-delta";

export const legacyDeltaMaxInputBytes = 16 * 1024 * 1024;
async function readSnapshot(filename: string): Promise<unknown> {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > legacyDeltaMaxInputBytes)
      throw new LegacyDeltaInputError();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.alloc(64 * 1024);
      const { bytesRead } = await file.read(chunk);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > legacyDeltaMaxInputBytes) throw new LegacyDeltaInputError();
      chunks.push(chunk.subarray(0, bytesRead));
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new LegacyDeltaInputError();
    }
  } finally {
    await file.close();
  }
}
async function writeExclusive(filename: string, value: unknown) {
  const serialized = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(serialized) > legacyDeltaMaxInputBytes)
    throw new LegacyDeltaInputError();
  const output = await open(
    filename,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await output.writeFile(serialized);
    await output.sync();
  } finally {
    await output.close();
  }
}
function optionsFor(
  args: string[],
  required: string[],
  pathOptions = required,
): Map<string, string> {
  const options = new Map<string, string>();
  if (args.length !== required.length * 2) throw new LegacyDeltaInputError();
  for (let i = 0; i < args.length; i += 2) {
    if (
      !required.includes(args[i]) ||
      options.has(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new LegacyDeltaInputError();
    options.set(
      args[i],
      pathOptions.includes(args[i]) ? path.resolve(args[i + 1]) : args[i + 1],
    );
  }
  if (required.some((option) => !options.has(option)))
    throw new LegacyDeltaInputError();
  return options;
}
export function legacyDeltaExportEnvironment(
  env: NodeJS.ProcessEnv,
  database: string,
) {
  if (
    env.INNOCHEM_DELTA_EXPORT_READ_ONLY !== "1" ||
    env.PGDATABASE !== database ||
    !/^innochem(?:_[a-z0-9_]+)?$/.test(database) ||
    !env.PGHOST ||
    !env.PGUSER ||
    env.PGOPTIONS
  )
    throw new LegacyDeltaInputError();
  if (
    env.PGPORT &&
    (!/^[0-9]+$/.test(env.PGPORT) ||
      Number(env.PGPORT) < 1 ||
      Number(env.PGPORT) > 65535)
  )
    throw new LegacyDeltaInputError();
  // Return non-secret confirmation only. Client reads existing PG* environment in RAM.
  return { readOnly: true, explicitDatabaseConfirmed: true };
}
export async function normalizeLegacyDeltaFiles(args: string[]) {
  const options = optionsFor(args, [
    "--input",
    "--media-inventory",
    "--output",
  ]);
  const inputs = [options.get("--input")!, options.get("--media-inventory")!];
  if (
    inputs.includes(options.get("--output")!) ||
    (await realpath(inputs[0])) === (await realpath(inputs[1]))
  )
    throw new LegacyDeltaInputError();
  const normalized = normalizeLegacyDeltaSource(
    await readSnapshot(inputs[0]),
    await readSnapshot(inputs[1]),
  );
  await writeExclusive(options.get("--output")!, normalized.snapshot);
  return {
    written: true,
    readOnly: true,
    exclusions: normalized.exclusions,
    ignoredTableCounts: normalized.ignoredTableCounts,
  };
}
async function exportTargetFile(args: string[]) {
  if (args.filter((arg) => arg === "--confirm-read-only").length !== 1)
    throw new LegacyDeltaInputError();
  const options = optionsFor(
    args.filter((arg) => arg !== "--confirm-read-only"),
    ["--database", "--output"],
    ["--output"],
  );
  legacyDeltaExportEnvironment(process.env, options.get("--database")!);
  const { Client } = await import("pg");
  const client = new Client({
    application_name: "innochem-legacy-delta-read-only",
    connectionTimeoutMillis: 5000,
  });
  let disconnected = false;
  // An idle connection error must not become an uncaught stderr dump.
  client.on("error", () => {
    disconnected = true;
  });
  try {
    await client.connect();
    const snapshot = await exportLegacyDeltaTarget({
      dedicatedConnection: true,
      query: (sql) => client.query(sql),
    });
    if (disconnected) throw new Error("Read-only export disconnected");
    await writeExclusive(options.get("--output")!, snapshot);
    return { written: true, readOnly: true };
  } finally {
    await client.end();
  }
}
export function legacyDeltaCommand(args: string[]) {
  if (args[0] === "normalize-source")
    return normalizeLegacyDeltaFiles(args.slice(1));
  if (args[0] === "export-target") return exportTargetFile(args.slice(1));
  return reportLegacyDelta(args);
}
export async function reportLegacyDelta(args: string[]) {
  const required = ["--baseline", "--final", "--target", "--output"];
  const options = new Map<string, string>();
  if (args.length !== 8)
    throw new Error(
      "Use --baseline FILE --final FILE --target FILE --output NEW_FILE",
    );
  for (let i = 0; i < args.length; i += 2) {
    if (
      !required.includes(args[i]) ||
      options.has(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new Error(
        "Use --baseline FILE --final FILE --target FILE --output NEW_FILE",
      );
    options.set(args[i], path.resolve(args[i + 1]));
  }
  if (required.some((name) => !options.has(name)))
    throw new LegacyDeltaInputError();
  const inputs = required.slice(0, 3).map((name) => options.get(name)!);
  const realInputs = await Promise.all(inputs.map((name) => realpath(name)));
  // Separate files make the provenance explicit; output never overwrites anything.
  if (
    new Set(realInputs).size !== 3 ||
    inputs.includes(options.get("--output")!)
  )
    throw new LegacyDeltaInputError();
  const snapshots = [];
  for (const filename of inputs) snapshots.push(await readSnapshot(filename));
  const report = compareLegacyDelta(snapshots[0], snapshots[1], snapshots[2]);
  await writeExclusive(options.get("--output")!, report);
  return {
    written: true,
    changes: report.changes.length,
    fullOverwriteAllowed: false,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  legacyDeltaCommand(process.argv.slice(2))
    .then((summary) => console.log(JSON.stringify(summary)))
    .catch((error: unknown) => {
      // Do not print arbitrary filesystem errors, filenames, malformed keys or input values.
      console.error(
        error instanceof LegacyDeltaInputError
          ? error.message
          : "Legacy delta report failed; check local input paths, permissions and unused output filename",
      );
      process.exitCode = 1;
    });
}
