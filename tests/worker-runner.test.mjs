import test from "node:test";
import assert from "node:assert/strict";
import { runWorkerCycle } from "../ops/worker-once.mjs";
test("worker scheduler keeps queue errors visible, sanitizes logs and only writes a successful heartbeat", async () => {
  const files = [],
    logs = [];
  let data = {
    enabled: true,
    healthy: false,
    errors: ["mail", "synthetic secret"],
    warnings: [],
    expired: 1,
    mail: { sent: 0, failed: 0, uncertain: 0, password: "do not log" },
  };
  const options = {
    secret: "s".repeat(32),
    fetcher: async () => Response.json(data),
    writer: async (file) => {
      files.push(file);
    },
    logger: (record) => {
      logs.push(record);
    },
  };
  await assert.rejects(runWorkerCycle(options), /incomplete/);
  assert.deepEqual(files, ["/tmp/innochem-worker-attempt"]);
  assert.deepEqual(logs[0].errors, ["mail"]);
  assert.ok(!JSON.stringify(logs).includes("secret"));
  assert.ok(!JSON.stringify(logs).includes("password"));
  data = { enabled: false, healthy: true, errors: [], warnings: [] };
  await runWorkerCycle(options);
  assert.equal(files.at(-1), "/tmp/innochem-worker-heartbeat");
  data = {
    enabled: true,
    healthy: true,
    errors: [],
    warnings: ["payments"],
    payments: { checked: 1, failed: 1 },
  };
  const result = await runWorkerCycle(options);
  assert.deepEqual(result.warnings, ["payments"]);
  assert.equal(result.payments.failed, 1);
  const before = files.length;
  await assert.rejects(
    runWorkerCycle({
      ...options,
      fetcher: async () => new Response(null, { status: 503 }),
    }),
    /request failed/,
  );
  assert.equal(files.length, before);
});
