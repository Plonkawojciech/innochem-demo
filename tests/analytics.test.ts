import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, query } from "../lib/server/db";
import { createOrder, markOrderPaid } from "../lib/server/orders";
import { actOnOrder } from "../lib/server/admin-orders";
import { deliverAnalyticsBatch, revokeConsent } from "../lib/server/analytics";
import { legalCommerce, legalHash } from "../lib/server/legal";
import { settingsSchema } from "../lib/server/settings";
if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error("Dedicated test database required");
after(async () => database().end());
const settings = {
  checkoutEnabled: true,
  shippingApproved: true,
  legalApproved: true,
  termsVersion: "test-1",
  shippingMethods: [
    {
      id: "test-courier",
      label: "Testowy kurier",
      priceCents: 1500,
      cod: true,
      enabled: true,
    },
  ],
  paymentMethods: ["bank_transfer", "cod"],
  bankAccount: "TEST ONLY — NOT A REAL BANK ACCOUNT",
  orderEmail: "store@example.test",
  contactEmail: "contact@example.test",
};
async function fixture(stock = 5, mode = "retail") {
  const documents = [
    {
      slug: "regulamin",
      title: "Synthetic terms",
      bodyHtml: "<p>Only synthetic integration test terms.</p>",
    },
  ];
  const commerce = legalCommerce(settingsSchema.parse(settings));
  await query(
    "INSERT INTO legal_versions(version,documents,commerce,content_hash,approved_by) VALUES('test-1',$1,$2,$3,'test') ON CONFLICT DO NOTHING",
    [
      JSON.stringify(documents),
      JSON.stringify(commerce),
      legalHash(documents, commerce),
    ],
  );
  await query("UPDATE settings SET value=$1 WHERE key='store'", [
    JSON.stringify(settings),
  ]);
  const {
    rows: [p],
  } = await query(
    "INSERT INTO products(slug,name,price_cents,stock,status,sale_mode) VALUES($1,'Test oil',8000,$2,'active',$3) RETURNING id",
    [randomUUID(), stock, mode],
  );
  return {
    idempotencyKey: randomUUID(),
    lines: [{ productId: p.id as string, quantity: 1 }],
    buyer: {
      firstName: "Test",
      lastName: "Customer",
      email: "buyer@example.test",
      phone: "123456789",
      company: "",
      nip: "",
    },
    address: {
      street: "Test 1",
      postalCode: "00-001",
      city: "Warszawa",
      country: "PL",
    },
    shippingMethod: "test-courier",
    paymentMethod: "bank_transfer",
    expectedTotalCents: 9500,
    termsAccepted: true,
    termsVersion: "test-1",
  };
}
async function consentFixture() {
  const at = new Date().toISOString();
  const c = (
    await query(
      "INSERT INTO analytics_consents(granted_at,expires_at) VALUES($1,now()+interval '6 months') RETURNING id",
      [at],
    )
  ).rows[0];
  return {
    id: c.id as string,
    analytics: {
      client_id: "123456.789012",
      session_id: "1234567890",
      v: 1 as const,
      at,
    },
  };
}
async function paid(consent = true) {
  const input = await fixture();
  const c = consent ? await consentFixture() : null;
  const order = await createOrder(
    { ...input, analytics: c?.analytics },
    null,
    c?.id,
  );
  const ref = randomUUID();
  await markOrderPaid(order.id, ref, 9500, "PLN");
  return { order, ref, c, input };
}
const entry = async (id: string, type = "purchase") =>
  (
    await query(
      "SELECT * FROM analytics_outbox WHERE order_id=$1 AND event_type=$2",
      [id, type],
    )
  ).rows[0];
async function configured(work: () => Promise<void>) {
  const before = [
    process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID,
    process.env.GA4_API_SECRET,
  ];
  process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID = "G-TEST123";
  process.env.GA4_API_SECRET = "synthetic-not-a-secret";
  try {
    await work();
  } finally {
    for (const [i, k] of [
      "NEXT_PUBLIC_GA4_MEASUREMENT_ID",
      "GA4_API_SECRET",
    ].entries()) {
      if (before[i] === undefined) delete process.env[k];
      else process.env[k] = before[i];
    }
  }
}
test("analytics: accepted bank payment is unique and uses order VAT snapshot", async () => {
  const f = await paid();
  await markOrderPaid(f.order.id, f.ref, 9500, "PLN");
  await query("UPDATE products SET price_cents=1,tax_rate=5 WHERE id=$1", [
    f.input.lines[0].productId,
  ]);
  const a = await entry(f.order.id);
  assert.equal(a.status, "pending");
  assert.equal(a.payload.value, 65.04);
  assert.equal(a.payload.tax, 14.96);
  assert.equal(a.payload.shipping, 15);
  assert.equal(a.payload.transaction_id, f.order.number);
  assert.equal(
    (
      await query(
        "SELECT count(*)::int AS n FROM analytics_outbox WHERE order_id=$1",
        [f.order.id],
      )
    ).rows[0].n,
    1,
  );
});
test("analytics: missing consent and unbound client identifiers are skipped", async () => {
  const f = await paid(false);
  assert.equal((await entry(f.order.id)).last_error, "no_consent");
  assert.equal((await entry(f.order.id)).status, "skipped");
  const c = await consentFixture();
  const order = await createOrder({
    ...(await fixture()),
    analytics: c.analytics,
  });
  await markOrderPaid(order.id, randomUUID(), 9500, "PLN");
  assert.equal((await entry(order.id)).last_error, "no_consent");
});
test("analytics: COD only records skipped order_submitted", async () => {
  const order = await createOrder({
    ...(await fixture()),
    paymentMethod: "cod",
  });
  assert.equal(await entry(order.id), undefined);
  const a = await entry(order.id, "order_submitted");
  assert.equal(a.status, "skipped");
  assert.equal(a.last_error, "cod");
});
test("analytics: absent GA4 configuration skips without HTTP", async () => {
  await configured(async () => {
    const f = await paid();
    delete process.env.GA4_API_SECRET;
    delete process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
    let calls = 0;
    await deliverAnalyticsBatch(async () => {
      calls++;
      throw new Error("must not send");
    });
    assert.equal(calls, 0);
    assert.equal((await entry(f.order.id)).status, "skipped");
    assert.equal((await entry(f.order.id)).last_error, "disabled");
  });
});
test("analytics: revocation invalidates queued and future events", async () => {
  const f = await paid();
  await revokeConsent(f.c!.id);
  assert.equal((await entry(f.order.id)).last_error, "no_consent");
  assert.equal((await entry(f.order.id)).client_id, null);
  await actOnOrder(
    f.order.id,
    {
      action: "record_refund",
      expectedStatus: "paid",
      idempotencyKey: randomUUID(),
      reference: "test",
      note: "Confirmed full refund",
      amountCents: 9500,
    },
    "test-admin",
  );
  assert.equal((await entry(f.order.id, "refund")).last_error, "no_consent");
});
test("analytics: full approved refund uses original amounts and is unique", async () => {
  const f = await paid();
  const action = {
    action: "record_refund",
    expectedStatus: "paid",
    idempotencyKey: randomUUID(),
    reference: "test",
    note: "Confirmed full refund",
    amountCents: 9500,
  };
  await actOnOrder(f.order.id, action, "test-admin");
  await actOnOrder(f.order.id, action, "test-admin");
  const { refund_id, ...payload } = (await entry(f.order.id, "refund")).payload;
  assert.equal(refund_id, `admin-order:${action.idempotencyKey}`);
  assert.deepEqual(payload, (await entry(f.order.id)).payload);
  assert.equal((await entry(f.order.id, "refund")).status, "pending");
});
test("analytics: shipping-only refunds stay in the ledger without a misleading full-refund event", async () => {
  const f = await paid();
  await actOnOrder(
    f.order.id,
    {
      action: "record_refund",
      expectedStatus: "paid",
      idempotencyKey: randomUUID(),
      reference: "SHIPPING-PROOF",
      note: "Actual shipping refund",
      amountCents: 1500,
      refundItems: [],
      shippingRefundCents: 1500,
    },
    "test-admin",
  );
  const a = await entry(f.order.id, "refund");
  assert.equal(a.status, "skipped");
  assert.equal(a.last_error, "refund_adjustment");
  assert.deepEqual(a.payload.items, []);
  assert.equal(a.payload.shipping, 15);
  assert.equal(
    (await query("SELECT status FROM orders WHERE id=$1", [f.order.id])).rows[0]
      .status,
    "paid",
  );
});
test("analytics: a mixed refund still reports actual item returns while money-only corrections stay in the ledger", async () => {
  const input = await fixture(),
    consent = await consentFixture();
  const p = (
    await query(
      "INSERT INTO products(slug,name,price_cents,stock,status,sale_mode) VALUES($1,'Second test oil',8000,5,'active','retail') RETURNING id",
      [randomUUID()],
    )
  ).rows[0];
  const o = await createOrder(
    {
      ...input,
      lines: [...input.lines, { productId: p.id, quantity: 1 }],
      expectedTotalCents: 17500,
      analytics: consent.analytics,
    },
    null,
    consent.id,
  );
  await markOrderPaid(o.id, randomUUID(), 17500, "PLN");
  const items = (
    await query(
      "SELECT id,product_id FROM order_items WHERE order_id=$1 ORDER BY id",
      [o.id],
    )
  ).rows;
  const first = items.find((i) => i.product_id === input.lines[0].productId)!,
    other = items.find((i) => i.product_id === p.id)!;
  const base = {
    action: "record_refund",
    expectedStatus: "paid",
    reference: "PROOF",
    note: "Actual item and money refunds",
  };
  await actOnOrder(
    o.id,
    {
      ...base,
      idempotencyKey: randomUUID(),
      amountCents: 4000,
      refundItems: [{ itemId: first.id, quantity: 1, amountCents: 4000 }],
      shippingRefundCents: 0,
    },
    "test-admin",
  );
  await actOnOrder(
    o.id,
    { ...base, idempotencyKey: randomUUID(), amountCents: 13500 },
    "test-admin",
  );
  const a = (
    await query(
      "SELECT * FROM analytics_outbox WHERE order_id=$1 AND event_type='refund' ORDER BY created_at",
      [o.id],
    )
  ).rows[1];
  assert.equal(a.status, "pending");
  assert.equal(a.payload.items.length, 1);
  assert.equal(a.payload.items[0].item_id, p.id);
  assert.equal(a.payload.items[0].quantity, 1);
  assert.equal(a.payload.value, 65.04);
  assert.equal(a.payload.shipping, 15);
});
test("analytics: a different event key cannot duplicate purchase at the database boundary", async () => {
  const f = await paid();
  await assert.rejects(
    query(
      "INSERT INTO analytics_outbox(order_id,event_type,payload,status,event_key) VALUES($1,'purchase','{}','pending',$2)",
      [f.order.id, randomUUID()],
    ),
    { code: "23514" },
  );
  assert.equal(
    (
      await query(
        "SELECT count(*)::int n FROM analytics_outbox WHERE order_id=$1 AND event_type='purchase'",
        [f.order.id],
      )
    ).rows[0].n,
    1,
  );
});
test("analytics: concurrent workers send once; HTTP payload has no buyer data", async () => {
  await configured(async () => {
    const f = await paid();
    const bodies: Record<string, any>[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    };
    await Promise.all([
      deliverAnalyticsBatch(fetcher),
      deliverAnalyticsBatch(fetcher),
    ]);
    const body = bodies.filter(
      (b) => b.events[0].params.transaction_id === f.order.number,
    );
    assert.equal(body.length, 1);
    assert.deepEqual(body[0].consent, {
      ad_user_data: "DENIED",
      ad_personalization: "DENIED",
    });
    assert.equal(body[0].events[0].params.session_id, 1234567890);
    assert.ok(!JSON.stringify(body).includes("buyer@example.test"));
    assert.equal((await entry(f.order.id)).status, "sent");
  });
});
test("analytics: HTTP failures back off, stop at five attempts, redact errors", async () => {
  await configured(async () => {
    const f = await paid();
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      return new Response("private provider body", { status: 503 });
    };
    for (let i = 1; i <= 5; i++) {
      await deliverAnalyticsBatch(fetcher);
      const a = await entry(f.order.id);
      assert.equal(a.attempts, i);
      assert.equal(a.last_error, "http_503");
      assert.equal(a.status, i === 5 ? "failed" : "pending");
      assert.ok(new Date(a.next_attempt_at).getTime() > Date.now() + 50000);
      const previous = calls;
      await deliverAnalyticsBatch(fetcher);
      assert.equal(calls, previous);
      await query(
        "UPDATE analytics_outbox SET next_attempt_at=now() WHERE id=$1",
        [a.id],
      );
    }
  });
});
test("analytics: transport failure does not leak URL or throw from worker", async () => {
  await configured(async () => {
    const f = await paid();
    await deliverAnalyticsBatch(async () => {
      throw new Error("https://provider/?api_secret=private");
    });
    assert.equal((await entry(f.order.id)).last_error, "transport_error");
  });
});
