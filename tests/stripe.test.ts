import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { NextRequest } from "next/server";
import { database, query } from "../lib/server/db";
import {
  createOrder,
  cancelPendingOrder,
  expireReservations,
} from "../lib/server/orders";
import {
  applyStripeSession,
  startStripePayment,
  cancelStripePayment,
  refreshStripePayment,
  handleStripeEvent,
  verifyStripeEvent,
  type StripeGateway,
} from "../lib/server/stripe-payments";
import { stripeCheckoutReady } from "../lib/server/stripe-config";
import { legalCommerce, legalHash } from "../lib/server/legal";
import { settingsSchema } from "../lib/server/settings";
import { POST as paymentPost } from "../app/api/orders/[id]/payment/route";
import {
  GET as statusGet,
  POST as statusPost,
} from "../app/api/orders/[id]/payment/status/route";
import { POST as webhookPost } from "../app/api/payments/stripe/webhook/route";
if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error("Dedicated test database required");
after(async () => database().end());
async function fixture() {
  const settings = settingsSchema.parse({
    checkoutEnabled: true,
    shippingApproved: true,
    legalApproved: true,
    termsVersion: "stripe-synthetic",
    shippingMethods: [
      {
        id: "test-courier",
        label: "Synthetic courier",
        priceCents: 1500,
        enabled: true,
        cod: false,
      },
    ],
    paymentMethods: ["stripe"],
    bankAccount: "",
    orderEmail: "store@example.test",
    contactEmail: "contact@example.test",
  });
  const documents = [
      {
        slug: "regulamin",
        title: "Synthetic terms",
        bodyHtml: "<p>Only isolated test data.</p>",
      },
    ],
    commerce = legalCommerce(settings);
  await query(
    "INSERT INTO legal_versions(version,documents,commerce,content_hash,approved_by) VALUES($1,$2,$3,$4,'synthetic') ON CONFLICT DO NOTHING",
    [
      settings.termsVersion,
      JSON.stringify(documents),
      JSON.stringify(commerce),
      legalHash(documents, commerce),
    ],
  );
  await query("UPDATE settings SET value=$1 WHERE key='store'", [
    JSON.stringify(settings),
  ]);
  const product = (
    await query(
      "INSERT INTO products(slug,name,price_cents,stock,status,sale_mode) VALUES($1,'Synthetic Stripe oil',8000,5,'active','retail') RETURNING id",
      [randomUUID()],
    )
  ).rows[0];
  const before = { ...process.env };
  let order;
  try {
    Object.assign(process.env, {
      STRIPE_MODE: "test",
      STRIPE_SECRET_KEY: "sk_test_synthetic_not_usable",
      STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
      PAYMENTS_ENABLED: "true",
      STRIPE_TEST_CHECKOUT_ENABLED: "true",
    });
    order = await createOrder({
      idempotencyKey: randomUUID(),
      lines: [{ productId: product.id, quantity: 1 }],
      buyer: {
        firstName: "Synthetic",
        lastName: "Buyer",
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
      paymentMethod: "stripe",
      expectedTotalCents: 9500,
      termsAccepted: true,
      termsVersion: settings.termsVersion,
    });
  } finally {
    for (const k of [
      "STRIPE_MODE",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "PAYMENTS_ENABLED",
      "STRIPE_TEST_CHECKOUT_ENABLED",
    ])
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
  }
  const session = {
    id: `cs_test_${randomUUID().replaceAll("-", "")}`,
    object: "checkout.session",
    mode: "payment",
    livemode: false,
    status: "open",
    payment_status: "unpaid",
    amount_total: 9500,
    currency: "pln",
    client_reference_id: order!.id,
    metadata: { orderId: order!.id, integration: "innochem-v1" },
    payment_intent: null,
    url: "https://checkout.stripe.com/c/pay/synthetic",
  } as unknown as Stripe.Checkout.Session;
  const calls: { request: Stripe.Checkout.SessionCreateParams; key: string }[] =
    [];
  const gateway: StripeGateway = {
    create: async (request, key) => {
      calls.push({ request, key });
      return structuredClone(session);
    },
    retrieve: async () => structuredClone(session),
    expire: async () => {
      session.status = "expired";
      return structuredClone(session);
    },
  };
  const stock = async () =>
    (
      await query("SELECT stock,reserved FROM products WHERE id=$1", [
        product.id,
      ])
    ).rows[0];
  const status = async () =>
    (await query("SELECT status FROM orders WHERE id=$1", [order!.id])).rows[0]
      .status;
  function paid() {
    session.status = "complete";
    session.payment_status = "paid";
    session.payment_intent = `pi_${randomUUID().replaceAll("-", "")}`;
    session.url = null;
  }
  return {
    order: order!,
    product,
    session,
    gateway,
    calls,
    stock,
    status,
    paid,
  };
}
function event(
  session: Stripe.Checkout.Session,
  type = "checkout.session.completed",
  id = `evt_${randomUUID()}`,
) {
  return {
    id,
    type,
    livemode: false,
    data: { object: structuredClone(session) },
  } as Stripe.Event;
}
const rejected = (code: string) => (e: unknown) =>
  !!e && typeof e === "object" && "code" in e && e.code === code;
test("concurrent payment starts reuse an immutable amount and one provider idempotency key", async () => {
  const f = await fixture();
  const results = await Promise.all([
    startStripePayment(f.order.id, f.gateway),
    startStripePayment(f.order.id, f.gateway),
  ]);
  assert.equal(results[0].url, results[1].url);
  assert.ok(f.calls.length >= 1);
  assert.ok(
    f.calls.every(
      (c) =>
        c.key === f.calls[0].key &&
        JSON.stringify(c.request) === JSON.stringify(f.calls[0].request),
    ),
  );
  assert.deepEqual(f.calls[0].request.payment_method_types, [
    "card",
    "blik",
    "p24",
  ]);
  assert.equal(
    f.calls[0].request.line_items?.reduce(
      (n, i) => n + (i.quantity || 0) * (i.price_data?.unit_amount || 0),
      0,
    ),
    9500,
  );
  await query("UPDATE products SET price_cents=123 WHERE id=$1", [
    f.product.id,
  ]);
  await startStripePayment(f.order.id, f.gateway);
  assert.deepEqual(await f.stock(), { stock: 5, reserved: 1 });
  assert.equal(
    (
      await query(
        "SELECT count(*)::int AS n FROM payment_sessions WHERE order_id=$1",
        [f.order.id],
      )
    ).rows[0].n,
    1,
  );
});
test("a lost create response retries the same session request and retains stock until reconciliation", async () => {
  const f = await fixture();
  let calls = 0;
  const gateway = {
    ...f.gateway,
    create: async (
      request: Stripe.Checkout.SessionCreateParams,
      key: string,
    ) => {
      const result = await f.gateway.create(request, key);
      if (++calls === 1)
        throw new Error("Synthetic timeout after provider accepted");
      return result;
    },
  };
  await assert.rejects(
    startStripePayment(f.order.id, gateway),
    rejected("PAYMENT_PROVIDER_UNAVAILABLE"),
  );
  await assert.rejects(
    cancelPendingOrder(f.order.id),
    rejected("PAYMENT_CHECK_REQUIRED"),
  );
  await query(
    "UPDATE orders SET reservation_expires_at=now()-interval '1 minute' WHERE id=$1",
    [f.order.id],
  );
  await expireReservations();
  assert.deepEqual(await f.stock(), { stock: 5, reserved: 1 });
  await startStripePayment(f.order.id, gateway);
  assert.deepEqual(f.calls[0], f.calls[1]);
});
test("signed webhooks require unmodified bytes, the correct secret and a recent timestamp", async () => {
  const before = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_synthetic_only";
  try {
    const payload = JSON.stringify({
      id: "evt_synthetic",
      type: "unused",
      data: { object: {} },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    });
    assert.equal(verifyStripeEvent(payload, signature).id, "evt_synthetic");
    assert.throws(
      () => verifyStripeEvent(payload + " ", signature),
      rejected("SIGNATURE_INVALID"),
    );
    assert.throws(
      () =>
        verifyStripeEvent(
          payload,
          Stripe.webhooks.generateTestHeaderString({
            payload,
            secret: "wrong",
          }),
        ),
      rejected("SIGNATURE_INVALID"),
    );
    assert.throws(
      () =>
        verifyStripeEvent(
          payload,
          Stripe.webhooks.generateTestHeaderString({
            payload,
            secret: process.env.STRIPE_WEBHOOK_SECRET!,
            timestamp: Math.floor(Date.now() / 1000) - 600,
          }),
        ),
      rejected("SIGNATURE_INVALID"),
    );
    assert.equal(
      (
        await webhookPost(
          new Request("http://localhost/api/payments/stripe/webhook", {
            method: "POST",
            headers: { "stripe-signature": signature },
            body: payload,
          }),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await webhookPost(
          new Request("http://localhost/api/payments/stripe/webhook", {
            method: "POST",
            body: "x".repeat(256001),
          }),
        )
      ).status,
      413,
    );
  } finally {
    if (before === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = before;
  }
});
test("simultaneous duplicate webhook deliveries commit stock and payment mail exactly once", async () => {
  const f = await fixture();
  await startStripePayment(f.order.id, f.gateway);
  f.paid();
  const e = event(f.session);
  await Promise.all([
    handleStripeEvent(e, f.gateway),
    handleStripeEvent(e, f.gateway),
    handleStripeEvent(event(f.session), f.gateway),
  ]);
  assert.equal(await f.status(), "paid");
  assert.deepEqual(await f.stock(), { stock: 4, reserved: 0 });
  assert.equal(
    (
      await query(
        "SELECT count(*)::int AS n FROM stock_movements WHERE order_id=$1",
        [f.order.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await query(
        "SELECT count(*)::int AS n FROM mail_outbox WHERE event_key=$1",
        [`order:${f.order.id}:paid`],
      )
    ).rows[0].n,
    1,
  );
});
test("provider confirmations are bound to the order, session, amount, currency and mode", async () => {
  const f = await fixture();
  await startStripePayment(f.order.id, f.gateway);
  f.paid();
  for (const change of [
    { amount_total: 1 },
    { currency: "eur" },
    { livemode: true },
    { id: "cs_test_other" },
    { mode: "subscription" },
    { client_reference_id: randomUUID() },
    { metadata: { orderId: randomUUID(), integration: "innochem-v1" } },
    { payment_intent: null },
    { status: "open" },
  ]) {
    await assert.rejects(
      applyStripeSession({
        ...f.session,
        ...change,
      } as Stripe.Checkout.Session),
      rejected("PAYMENT_BINDING"),
    );
  }
  assert.equal(await f.status(), "pending_payment");
  assert.deepEqual(await f.stock(), { stock: 5, reserved: 1 });
});
test("a stale failed event fetches current paid state and cannot undo fulfillment", async () => {
  const f = await fixture();
  await startStripePayment(f.order.id, f.gateway);
  const stale = event(f.session, "checkout.session.async_payment_failed");
  f.paid();
  await handleStripeEvent(stale, f.gateway);
  await handleStripeEvent(
    event(f.session, "checkout.session.expired"),
    f.gateway,
  );
  assert.equal(await f.status(), "paid");
  assert.deepEqual(await f.stock(), { stock: 4, reserved: 0 });
});
test("delayed payments hold stock until definitive success or failure", async () => {
  const f = await fixture();
  await startStripePayment(f.order.id, f.gateway);
  f.session.status = "complete";
  await handleStripeEvent(event(f.session), f.gateway);
  assert.equal(
    (
      await query("SELECT reservation_expires_at FROM orders WHERE id=$1", [
        f.order.id,
      ])
    ).rows[0].reservation_expires_at,
    null,
  );
  await expireReservations();
  await assert.rejects(
    cancelStripePayment(f.order.id, f.gateway),
    rejected("PAYMENT_IN_PROGRESS"),
  );
  assert.deepEqual(await f.stock(), { stock: 5, reserved: 1 });
  await handleStripeEvent(
    event(f.session, "checkout.session.async_payment_failed"),
    f.gateway,
  );
  assert.equal(await f.status(), "cancelled");
  assert.deepEqual(await f.stock(), { stock: 5, reserved: 0 });
  f.paid();
  await handleStripeEvent(
    event(f.session, "checkout.session.async_payment_succeeded"),
    f.gateway,
  );
  assert.equal(await f.status(), "payment_review");
  assert.deepEqual(await f.stock(), { stock: 5, reserved: 0 });
});
test("admin cancellation expires the provider session before releasing inventory", async () => {
  const f = await fixture();
  await startStripePayment(f.order.id, f.gateway);
  await cancelStripePayment(f.order.id, f.gateway);
  await cancelStripePayment(f.order.id, f.gateway);
  assert.equal(f.session.status, "expired");
  assert.equal(await f.status(), "cancelled");
  assert.deepEqual(await f.stock(), { stock: 5, reserved: 0 });
});
test("recovery from an interrupted creation verifies the session instead of trusting its pasted ID", async () => {
  const f = await fixture();
  await assert.rejects(
    startStripePayment(f.order.id, {
      ...f.gateway,
      create: async () => {
        throw new Error("Synthetic timeout");
      },
    }),
  );
  await assert.rejects(
    refreshStripePayment(f.order.id, f.gateway, "cs_test_wrong"),
    rejected("PAYMENT_BINDING"),
  );
  await refreshStripePayment(f.order.id, f.gateway, f.session.id);
  assert.equal(
    (
      await query(
        "SELECT provider_session_id FROM payment_sessions WHERE order_id=$1",
        [f.order.id],
      )
    ).rows[0].provider_session_id,
    f.session.id,
  );
});
test("payment routes require order ownership and same-origin writes, and return no personal data", async () => {
  const f = await fixture(),
    ctx = { params: Promise.resolve({ id: f.order.id }) },
    origin = process.env.APP_URL!;
  const request = (method: string, cookie?: string, source = origin) =>
    new NextRequest(`${origin}/api/orders/${f.order.id}/payment`, {
      method,
      headers: { origin: source, ...(cookie ? { cookie } : {}) },
    });
  assert.equal((await paymentPost(request("POST"), ctx)).status, 404);
  assert.equal((await statusGet(request("GET"), ctx)).status, 404);
  const cookie = `innochem_order_${f.order.id}=${f.order.accessToken}`;
  assert.equal(
    (await paymentPost(request("POST", cookie, "https://example.invalid"), ctx))
      .status,
    403,
  );
  assert.equal(
    (await statusPost(request("POST", cookie, "https://example.invalid"), ctx))
      .status,
    403,
  );
  const response = await statusGet(request("GET", cookie), ctx);
  assert.deepEqual(await response.json(), {
    status: "pending_payment",
    paymentState: null,
  });
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal((await paymentPost(request("POST", cookie), ctx)).status, 503);
});
test("a preview cannot enable real payments even with live switches set", async () => {
  const before = { ...process.env };
  try {
    Object.assign(process.env, {
      STOREFRONT_PREVIEW: "true",
      STRIPE_MODE: "live",
      STRIPE_SECRET_KEY: "sk_live_synthetic_not_usable",
      STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
      PAYMENTS_ENABLED: "true",
      STRIPE_TEST_CHECKOUT_ENABLED: "true",
    });
    assert.equal(stripeCheckoutReady(), false);
    await assert.rejects(
      startStripePayment(randomUUID()),
      rejected("PAYMENT_PREVIEW"),
    );
  } finally {
    for (const k of [
      "STOREFRONT_PREVIEW",
      "STRIPE_MODE",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "PAYMENTS_ENABLED",
      "STRIPE_TEST_CHECKOUT_ENABLED",
    ])
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
  }
});
