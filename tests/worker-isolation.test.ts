import test from "node:test";
import assert from "node:assert/strict";
import { runWorker } from "../lib/server/worker";
test("a disabled worker is reachable and item failures are reported without hiding queue liveness", async () => {
  const before = process.env.STORE_WORKER_ENABLED;
  try {
    process.env.STORE_WORKER_ENABLED = "false";
    const disabled = await runWorker();
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.healthy, true);
    process.env.STORE_WORKER_ENABLED = "true";
    const result = await runWorker({
      payments: async () => ({ checked: 1, failed: 1 }),
      reservations: async () => 0,
      mail: async () => ({ enabled: true, sent: 0, failed: 0, uncertain: 1 }),
      analytics: async () => ({ sent: 0, skipped: 0, failed: 1 }),
    });
    assert.equal(result.healthy, true);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, ["payments", "mail", "analytics"]);
  } finally {
    if (before === undefined) delete process.env.STORE_WORKER_ENABLED;
    else process.env.STORE_WORKER_ENABLED = before;
  }
});
test("SMTP failure does not block analytics or reservation release and cannot be a healthy cycle", async () => {
  const before = process.env.STORE_WORKER_ENABLED;
  process.env.STORE_WORKER_ENABLED = "true";
  const calls: string[] = [];
  try {
    const result = await runWorker({
      payments: async () => {
        calls.push("payments");
        return { checked: 0, failed: 0 };
      },
      reservations: async () => {
        calls.push("reservations");
        return 1;
      },
      mail: async () => {
        calls.push("mail");
        throw new Error("synthetic credentials must not leak");
      },
      analytics: async () => {
        calls.push("analytics");
        return { sent: 1, skipped: 0, failed: 0 };
      },
    });
    assert.deepEqual(calls, ["payments", "reservations", "mail", "analytics"]);
    assert.equal(result.healthy, false);
    assert.deepEqual(result.errors, ["mail"]);
    assert.equal(result.expired, 1);
    assert.equal(result.analytics?.sent, 1);
    assert.ok(!JSON.stringify(result).includes("credentials"));
  } finally {
    if (before === undefined) delete process.env.STORE_WORKER_ENABLED;
    else process.env.STORE_WORKER_ENABLED = before;
  }
});
