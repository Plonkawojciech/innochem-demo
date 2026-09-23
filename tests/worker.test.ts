import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { query, database } from "../lib/server/db";
import { deliverMailBatch, enqueueMail } from "../lib/server/mail";
import { POST } from "../app/api/internal/worker/route";
if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error("Dedicated test database required");
after(async () => database().end());
async function fixture() {
  await query(
    "UPDATE mail_outbox SET available_at=now()+interval '1 day' WHERE sent_at IS NULL",
  );
  const key = randomUUID();
  await enqueueMail(
    "synthetic@example.test",
    "Synthetic",
    "Only an isolated transport test",
    key,
  );
  return key;
}
async function withDelivery(work: () => Promise<void>) {
  const mail = process.env.MAIL_DELIVERY_ENABLED,
    preview = process.env.STOREFRONT_PREVIEW;
  process.env.MAIL_DELIVERY_ENABLED = "true";
  process.env.STOREFRONT_PREVIEW = "false";
  try {
    await work();
  } finally {
    process.env.MAIL_DELIVERY_ENABLED = mail;
    process.env.STOREFRONT_PREVIEW = preview;
  }
}
test("a preview cannot send mail even with the SMTP switch accidentally enabled", async () => {
  const before = process.env.MAIL_DELIVERY_ENABLED;
  process.env.MAIL_DELIVERY_ENABLED = "true";
  let calls = 0;
  try {
    const result = await deliverMailBatch({
      sendMail: async () => {
        calls++;
      },
      close() {},
    });
    assert.equal(result.enabled, false);
    assert.equal(calls, 0);
  } finally {
    process.env.MAIL_DELIVERY_ENABLED = before;
  }
});
test("concurrent workers claim a mail once and persist the successful outcome", async () =>
  withDelivery(async () => {
    const key = await fixture();
    let calls = 0;
    const transport = {
      sendMail: async () => {
        calls++;
      },
      close() {},
    };
    await Promise.all([
      deliverMailBatch(transport),
      deliverMailBatch(transport),
    ]);
    assert.equal(calls, 1);
    const {
      rows: [row],
    } = await query(
      "SELECT delivery_state,sent_at,attempts FROM mail_outbox WHERE event_key=$1",
      [key],
    );
    assert.equal(row.delivery_state, "sent");
    assert.ok(row.sent_at);
    assert.equal(row.attempts, 1);
  }));
test("an ambiguous SMTP result and an expired sending lease are quarantined, never retried", async () =>
  withDelivery(async () => {
    const key = await fixture();
    let calls = 0;
    const transport = {
      sendMail: async () => {
        calls++;
        throw Object.assign(new Error("Synthetic timeout"), {
          code: "ETIMEDOUT",
          command: "DATA",
        });
      },
      close() {},
    };
    const result = await deliverMailBatch(transport);
    assert.equal(result.uncertain, 1);
    await deliverMailBatch(transport);
    assert.equal(calls, 1);
    assert.equal(
      (
        await query(
          "SELECT delivery_state FROM mail_outbox WHERE event_key=$1",
          [key],
        )
      ).rows[0].delivery_state,
      "uncertain",
    );
    const interrupted = await fixture();
    await query(
      "UPDATE mail_outbox SET delivery_state='sending',locked_until=now()-interval '1 minute' WHERE event_key=$1",
      [interrupted],
    );
    await deliverMailBatch(transport);
    assert.equal(calls, 1);
    assert.equal(
      (
        await query(
          "SELECT delivery_state FROM mail_outbox WHERE event_key=$1",
          [interrupted],
        )
      ).rows[0].delivery_state,
      "uncertain",
    );
  }));
test("a definite SMTP rejection is retryable and does not pretend to be sent", async () =>
  withDelivery(async () => {
    const key = await fixture();
    const result = await deliverMailBatch({
      sendMail: async () => {
        throw Object.assign(new Error("Synthetic rejection"), {
          responseCode: 451,
          command: "DATA",
        });
      },
      close() {},
    });
    assert.equal(result.failed, 1);
    const {
      rows: [row],
    } = await query(
      "SELECT delivery_state,sent_at,available_at>now() AS delayed FROM mail_outbox WHERE event_key=$1",
      [key],
    );
    assert.equal(row.delivery_state, "failed");
    assert.equal(row.sent_at, null);
    assert.equal(row.delayed, true);
  }));
test("worker endpoint requires a configured secret and remains disabled by default", async () => {
  const secret = process.env.WORKER_SECRET,
    enabled = process.env.STORE_WORKER_ENABLED;
  process.env.WORKER_SECRET = "synthetic-only-worker-secret-123456789";
  process.env.STORE_WORKER_ENABLED = "false";
  try {
    const url = "http://localhost/api/internal/worker";
    assert.equal(
      (await POST(new Request(url, { method: "POST" }))).status,
      401,
    );
    assert.equal(
      (
        await POST(
          new Request(url, {
            method: "POST",
            headers: { authorization: "Bearer wrong" },
          }),
        )
      ).status,
      401,
    );
    const r = await POST(
      new Request(url, {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.WORKER_SECRET}` },
      }),
    );
    assert.equal(r.status, 200);
    assert.equal((await r.json()).enabled, false);
  } finally {
    process.env.WORKER_SECRET = secret;
    process.env.STORE_WORKER_ENABLED = enabled;
  }
});

test("preview correspondence stays blocked after SMTP is enabled later", async () => {
  const key = await fixture();
  assert.equal(
    (await query("SELECT preview FROM mail_outbox WHERE event_key=$1", [key]))
      .rows[0].preview,
    true,
  );
  await withDelivery(async () => {
    let calls = 0;
    await deliverMailBatch({
      sendMail: async () => {
        calls++;
      },
      close() {},
    });
    assert.equal(calls, 0);
  });
  assert.equal(
    (await query("SELECT sent_at FROM mail_outbox WHERE event_key=$1", [key]))
      .rows[0].sent_at,
    null,
  );
});
