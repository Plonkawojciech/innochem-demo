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
async function isolateMailBatch() {
  await query(
    "UPDATE mail_outbox SET available_at=now()+interval '1 day' WHERE sent_at IS NULL",
  );
}
async function historicalMail(
  subject: string,
  body: string,
  state: "queued" | "failed" = "queued",
  recipient = "operator@example.test",
) {
  const key = randomUUID();
  // Deliberately bypass enqueue: this is an old production-shaped job.
  await query(
    "INSERT INTO mail_outbox(event_key,recipient,subject,body_text,preview,delivery_state) VALUES($1,$2,$3,$4,false,$5)",
    [key, recipient, subject, body, state],
  );
  return key;
}
function fakeTransport() {
  const receipt = { created: 0, closed: 0, messages: [] as { to: string }[] };
  const factory = () => {
    receipt.created++;
    return {
      sendMail: async (options: { to: string }) => {
        receipt.messages.push(options);
      },
      close() {
        receipt.closed++;
      },
    };
  };
  return { receipt, factory };
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
test("overlapping workers cannot send a second batch while SMTP is occupied", async () =>
  withDelivery(async () => {
    await fixture();
    for (let i = 0; i < 11; i++)
      await enqueueMail(
        "synthetic@example.test",
        "Synthetic",
        "Batch isolation",
        randomUUID(),
      );
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let calls = 0;
    const transport = {
      sendMail: async () => {
        calls++;
        started();
        await gate;
      },
      close() {},
    };
    const first = deliverMailBatch(transport);
    await entered;
    try {
      const overlap = await deliverMailBatch(transport);
      assert.equal("busy" in overlap && overlap.busy, true);
      assert.equal(overlap.sent, 0);
      assert.equal(calls, 1);
    } finally {
      release();
    }
    assert.equal((await first).sent, 10);
    assert.equal((await deliverMailBatch(transport)).sent, 2);
    assert.equal(calls, 12);
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

test("SMTP 550 retries after 15 minutes and stops after eight attempts", async () =>
  withDelivery(async () => {
    const key = await fixture();
    let calls = 0;
    const transport = {
      sendMail: async () => {
        calls++;
        throw Object.assign(new Error("Synthetic rejection"), {
          responseCode: 550,
          command: "DATA",
        });
      },
      close() {},
    };
    for (let attempt = 1; attempt <= 8; attempt++) {
      if (attempt > 1)
        await query(
          "UPDATE mail_outbox SET available_at=now()-interval '1 second' WHERE event_key=$1",
          [key],
        );
      assert.equal((await deliverMailBatch(transport)).failed, 1);
      const row = (
        await query(
          "SELECT delivery_state,attempts,sent_at,extract(epoch FROM available_at-now()) AS delay FROM mail_outbox WHERE event_key=$1",
          [key],
        )
      ).rows[0];
      assert.equal(row.delivery_state, "failed");
      assert.equal(row.attempts, attempt);
      assert.equal(row.sent_at, null);
      assert.ok(Number(row.delay) > 890 && Number(row.delay) <= 900);
      await deliverMailBatch(transport);
      assert.equal(calls, attempt);
    }
    await query(
      "UPDATE mail_outbox SET available_at=now()-interval '1 second' WHERE event_key=$1",
      [key],
    );
    await deliverMailBatch(transport);
    assert.equal(calls, 8);
    assert.equal(
      (
        await query("SELECT attempts FROM mail_outbox WHERE event_key=$1", [
          key,
        ])
      ).rows[0].attempts,
      8,
    );
  }));

test("QA is persisted as preview at enqueue and stays blocked after re-enabling delivery", async () => {
  await isolateMailBatch();
  const keys = [randomUUID(), randomUUID()];
  const { receipt, factory } = fakeTransport();
  await withDelivery(async () => {
    await enqueueMail(
      "operator@example.test",
      "INNOCHEM — [TeSt] automated receipt",
      "Synthetic body",
      keys[0],
    );
    await enqueueMail(
      "customer@example.test",
      "INNOCHEM — receipt",
      "\n\t\n [test] Synthetic receipt\nSecond line",
      keys[1],
    );
    assert.equal((await deliverMailBatch(factory)).sent, 0);
  });
  await withDelivery(async () => {
    assert.equal((await deliverMailBatch(factory)).sent, 0);
  });
  assert.deepEqual(receipt, { created: 0, closed: 0, messages: [] });
  const { rows } = await query(
    "SELECT preview,attempts,sent_at FROM mail_outbox WHERE event_key=ANY($1::text[])",
    [keys],
  );
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.preview, true);
    assert.equal(row.attempts, 0);
    assert.equal(row.sent_at, null);
  }
});

test("old queued and failed QA jobs are permanently blocked before leasing or constructing a transport", async (t) => {
  await isolateMailBatch();
  const { receipt, factory } = fakeTransport();
  let keys: string[] = [];
  let testOnlyCount = 0;
  await withDelivery(async () => {
    keys = [
      await historicalMail("  [TEST] old queued receipt  ", "Synthetic body"),
      await historicalMail(
        "INNOCHEM — old failed receipt",
        "\r\n \r\n\t[tEsT] first nonempty line\nSecond line",
        "failed",
        "customer@example.test",
      ),
    ];
    const result = await deliverMailBatch(factory);
    assert.equal(result.sent, 0);
    assert.equal(result.testOnly, 2);
    testOnlyCount = result.testOnly!;
  });
  let { rows } = await query(
    "SELECT preview,delivery_state,attempts,sent_at,last_error,locked_until FROM mail_outbox WHERE event_key=ANY($1::text[]) ORDER BY created_at,id",
    [keys],
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.delivery_state).sort(), [
    "failed",
    "queued",
  ]);
  for (const row of rows) {
    assert.equal(row.preview, true);
    assert.equal(row.attempts, 0);
    assert.equal(row.sent_at, null);
    assert.equal(row.locked_until, null);
    assert.equal(row.last_error, "QA_MAIL_DISABLED");
  }
  // The persisted flag still blocks the job in a fresh batch, without relying on the marker again.
  await query(
    "UPDATE mail_outbox SET subject='Ordinary-looking subject',body_text='Marker removed only in this isolated test',available_at=now() WHERE event_key=ANY($1::text[])",
    [keys],
  );
  await withDelivery(async () => {
    const result = await deliverMailBatch(factory);
    assert.equal(result.sent, 0);
    assert.equal(result.testOnly, 0);
  });
  assert.deepEqual(receipt, { created: 0, closed: 0, messages: [] });
  ({ rows } = await query(
    "SELECT preview,attempts,sent_at,last_error FROM mail_outbox WHERE event_key=ANY($1::text[])",
    [keys],
  ));
  assert.ok(
    rows.every(
      (row) =>
        row.preview &&
        row.attempts === 0 &&
        row.sent_at === null &&
        row.last_error === "QA_MAIL_DISABLED",
    ),
  );
  t.diagnostic(
    JSON.stringify({
      testOnly: true,
      testOnlyCount,
      qaDisabledCount: rows.filter(
        (row) => row.preview && row.last_error === "QA_MAIL_DISABLED",
      ).length,
      attempts: rows.reduce((sum, row) => sum + row.attempts, 0),
      sentCount: rows.filter((row) => row.sent_at !== null).length,
      transportConstructions: receipt.created,
      smtpCalls: receipt.messages.length,
    }),
  );
});

test("a mixed batch sends the customer's ordinary order but not QA, including a later quoted marker", async () => {
  await isolateMailBatch();
  const { receipt, factory } = fakeTransport();
  await withDelivery(async () => {
    const qa = await historicalMail(
      "[TEST] automated receipt",
      "Synthetic body",
    );
    const customer = await historicalMail(
      "INNOCHEM — zamówienie 42",
      "Zamówienie INNOCHEM 42\n\n[TEST] quoted customer note",
      "queued",
      "customer@example.test",
    );
    const result = await deliverMailBatch(factory);
    assert.equal(result.sent, 1);
    assert.equal(result.testOnly, 1);
    assert.equal(receipt.created, 1);
    assert.equal(receipt.closed, 1);
    assert.deepEqual(
      receipt.messages.map((message) => message.to),
      ["customer@example.test"],
    );
    const { rows } = await query(
      "SELECT event_key,preview,delivery_state,attempts,sent_at,last_error FROM mail_outbox WHERE event_key=ANY($1::text[])",
      [[qa, customer]],
    );
    const blocked = rows.find((row) => row.event_key === qa)!;
    const sent = rows.find((row) => row.event_key === customer)!;
    assert.equal(blocked.preview, true);
    assert.equal(blocked.attempts, 0);
    assert.equal(blocked.sent_at, null);
    assert.equal(blocked.last_error, "QA_MAIL_DISABLED");
    assert.equal(sent.preview, false);
    assert.equal(sent.delivery_state, "sent");
    assert.equal(sent.attempts, 1);
    assert.ok(sent.sent_at);
  });
});

test("an ordinary order to the operator remains deliverable without a QA marker", async () => {
  await isolateMailBatch();
  const { receipt, factory } = fakeTransport();
  await withDelivery(async () => {
    await historicalMail(
      "INNOCHEM — zamówienie 43",
      "Zamówienie INNOCHEM 43\nZwykły zakup",
    );
    assert.equal((await deliverMailBatch(factory)).sent, 1);
    assert.deepEqual(
      receipt.messages.map((message) => message.to),
      ["operator@example.test"],
    );
  });
});

test("a transport-construction failure does not lease ordinary customer mail", async () => {
  await isolateMailBatch();
  await withDelivery(async () => {
    const key = await historicalMail(
      "INNOCHEM — zamówienie 44",
      "Zwykły zakup",
    );
    await assert.rejects(
      deliverMailBatch(() => {
        throw new Error("Synthetic transport construction failure");
      }),
      /Synthetic transport construction failure/,
    );
    const {
      rows: [row],
    } = await query(
      "SELECT preview,delivery_state,attempts,sent_at,locked_until FROM mail_outbox WHERE event_key=$1",
      [key],
    );
    assert.equal(row.preview, false);
    assert.equal(row.delivery_state, "queued");
    assert.equal(row.attempts, 0);
    assert.equal(row.sent_at, null);
    assert.equal(row.locked_until, null);
  });
});
