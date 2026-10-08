import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const queues = ["payments", "reservations", "mail", "analytics"];
export async function runWorkerCycle({
  target = process.env.WORKER_URL ||
    "http://127.0.0.1:3000/api/internal/worker",
  secret = process.env.WORKER_SECRET,
  fetcher = fetch,
  writer = writeFile,
  logger = (record) => console.log(JSON.stringify(record)),
} = {}) {
  if (!secret || secret.length < 32)
    throw new Error("WORKER_SECRET is required");
  const response = await fetcher(new URL(target), {
    method: "POST",
    redirect: "error",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error("Worker request failed");
  const data = await response.json();
  if (
    typeof data.enabled !== "boolean" ||
    typeof data.healthy !== "boolean" ||
    !Array.isArray(data.errors) ||
    !Array.isArray(data.warnings)
  )
    throw new Error("Invalid worker result");
  const count = (value) =>
    Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const pick = (value, names) =>
    value
      ? Object.fromEntries(names.map((name) => [name, count(value[name])]))
      : null;
  const record = {
    at: new Date().toISOString(),
    enabled: data.enabled,
    healthy: data.healthy,
    errors: data.errors.filter((name) => queues.includes(name)),
    warnings: data.warnings.filter((name) => queues.includes(name)),
    expired: count(data.expired),
    payments: pick(data.payments, ["checked", "failed"]),
    mail: pick(data.mail, ["sent", "failed", "uncertain"]),
    analytics: pick(data.analytics, ["sent", "skipped", "failed"]),
  };
  await writer("/tmp/innochem-worker-attempt", String(Date.now()));
  logger(record);
  if (!data.healthy) throw new Error("Worker cycle incomplete");
  await writer("/tmp/innochem-worker-heartbeat", String(Date.now()));
  return record;
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  runWorkerCycle().catch(() => {
    console.error(
      "Store worker failed; check application health and operator configuration.",
    );
    process.exitCode = 1;
  });
}
