import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareLegacyDelta, LegacyDeltaInputError } from "../lib/legacy-delta";

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
  const output = await open(
    options.get("--output")!,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await output.writeFile(JSON.stringify(report, null, 2) + "\n");
    await output.sync();
  } finally {
    await output.close();
  }
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
  reportLegacyDelta(process.argv.slice(2))
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
