import { checkoutNetworkIsolation } from "./helpers/checkout-network-isolation.mjs";
import test, { before, after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import net from "node:net";
import { POST as checkoutPost } from "../app/api/orders/route";
import { POST as cartPost } from "../app/api/cart/route";
import { accessibleOrder, type CheckoutInput } from "../lib/server/orders";
import { database, query } from "../lib/server/db";
import { legalCommerce, legalHash } from "../lib/server/legal";
import { settingsSchema } from "../lib/server/settings";

before(async () => {
  const result = await query<{ name: string }>(
    "SELECT current_database() AS name",
  );
  assert.equal(result.rows[0].name, checkoutNetworkIsolation.database);
});
after(async () => {
  try {
    await database().end();
  } finally {
    process.env.PGHOST = checkoutNetworkIsolation.databaseHost;
  }
});

let ipNumber = 120;
async function fixture(t: TestContext, stock = 5) {
  const previous = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
  });
  const ip = `192.0.2.${ipNumber++}`;
  for (const bucket of ["checkout", "cart"])
    await query(
      "INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,0,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET hits=0,expires_at=excluded.expires_at",
      [createHash("sha256").update(`${bucket}:${ip}`).digest("hex")],
    );
  const settings = settingsSchema.parse({
    checkoutEnabled: true,
    shippingApproved: true,
    legalApproved: true,
    termsVersion: "checkout-http-synthetic",
    shippingMethods: [
      {
        id: "http-courier",
        label: "Synthetic courier",
        priceCents: 1500,
        cod: true,
        enabled: true,
      },
    ],
    paymentMethods: ["bank_transfer", "cod"],
    bankAccount: "TEST ONLY - NOT A REAL BANK ACCOUNT",
    orderEmail: "store@example.test",
    contactEmail: "contact@example.test",
  });
  const documents = [
    {
      slug: "regulamin",
      title: "Synthetic terms",
      bodyHtml: "<p>Only isolated checkout regression data.</p>",
    },
  ];
  const commerce = legalCommerce(settings);
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
      "INSERT INTO products(slug,name,price_cents,stock,status,sale_mode) VALUES($1,'Synthetic HTTP oil',8000,$2,'active','retail') RETURNING id",
      [randomUUID(), stock],
    )
  ).rows[0];
  const input: CheckoutInput = {
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
      street: "Synthetic 1",
      postalCode: "00-001",
      city: "Warszawa",
      country: "PL",
    },
    shippingMethod: "http-courier",
    paymentMethod: "bank_transfer",
    expectedTotalCents: 9500,
    termsAccepted: true,
    termsVersion: settings.termsVersion,
  };
  const request = (
    payload: unknown = input,
    origin: string | null = new URL(process.env.APP_URL!).origin,
    raw?: string,
  ) =>
    new Request(`${process.env.APP_URL}/api/orders`, {
      method: "POST",
      headers: {
        ...(origin === null ? {} : { origin }),
        "content-type": "application/json",
        "x-real-ip": ip,
      },
      body: raw ?? JSON.stringify(payload),
    });
  const state = async () => {
    const productState = (
      await query<{ stock: number; reserved: number }>(
        "SELECT stock,reserved FROM products WHERE id=$1",
        [product.id],
      )
    ).rows[0];
    const orders = await query(
      "SELECT id FROM orders WHERE idempotency_key=$1",
      [input.idempotencyKey],
    );
    return { ...productState, orders: orders.rowCount };
  };
  return { input, product, request, state, ip };
}

test("checkout POST persists one guest order and a private capability cookie without exposing buyer data", async (t) => {
  const f = await fixture(t);
  const response = await checkoutPost(f.request());
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["id", "number", "url"]);
  assert.equal(body.url, `/zamowienie/${body.id}`);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=7776000/);
  const token = cookie.match(/^[^=]+=([^;]+)/)![1];
  assert.equal(await accessibleOrder(body.id, null), null);
  assert.equal(await accessibleOrder(body.id, randomUUID()), null);
  const order = (await accessibleOrder(body.id, null, token))!.order;
  assert.equal(order.customer_id, null);
  assert.equal(order.total_cents, 9500);
  assert.equal(order.status, "pending_payment");
  assert.deepEqual(await f.state(), { stock: 5, reserved: 1, orders: 1 });
  const mail = await query(
    "SELECT preview,sent_at,body_text FROM mail_outbox WHERE event_key LIKE $1",
    [`order:${body.id}:created:%`],
  );
  assert.equal(mail.rowCount, 2);
  assert.ok(mail.rows.every((row) => row.preview && row.sent_at === null));
  assert.ok(mail.rows.every((row) => row.body_text.includes("95.00 zł")));
});

test("simultaneous checkout POST retries reuse the order and cookie, including after checkout closes", async (t) => {
  const f = await fixture(t);
  const responses = await Promise.all([
    checkoutPost(f.request()),
    checkoutPost(f.request()),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 201],
  );
  const bodies = await Promise.all(
    responses.map((response) => response.json()),
  );
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(
    responses[0].headers.get("set-cookie")!.split(";")[0],
    responses[1].headers.get("set-cookie")!.split(";")[0],
  );
  await query(
    "UPDATE settings SET value=jsonb_set(value,'{checkoutEnabled}','false') WHERE key='store'",
  );
  const retry = await checkoutPost(f.request());
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), bodies[0]);
  assert.deepEqual(await f.state(), { stock: 5, reserved: 1, orders: 1 });
  assert.equal(
    (
      await query(
        "SELECT count(*)::int AS n FROM mail_outbox WHERE event_key LIKE $1",
        [`order:${bodies[0].id}:created:%`],
      )
    ).rows[0].n,
    2,
  );
});

test("two HTTP buyers racing for the last unit get one order and one stock conflict", async (t) => {
  const f = await fixture(t, 1);
  const responses = await Promise.all([
    checkoutPost(f.request()),
    checkoutPost(f.request({ ...f.input, idempotencyKey: randomUUID() })),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [201, 409],
  );
  const failure = responses.find((response) => response.status === 409)!;
  assert.equal((await failure.json()).code, "OUT_OF_STOCK");
  assert.equal(
    (
      await query(
        "SELECT count(*)::int AS n FROM order_items WHERE product_id=$1",
        [f.product.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal((await f.state()).reserved, 1);
});

test("checkout rejects missing/foreign origins, malformed JSON and oversized bodies without an order or reservation", async (t) => {
  const f = await fixture(t);
  for (const origin of [null, "https://foreign.example.test"])
    assert.equal((await checkoutPost(f.request(f.input, origin))).status, 403);
  const invalid = await checkoutPost(f.request(f.input, undefined, "{"));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, "INVALID_REQUEST");
  const large = await checkoutPost(
    f.request(f.input, undefined, "x".repeat(32001)),
  );
  assert.equal(large.status, 413);
  assert.equal((await large.json()).code, "REQUEST_TOO_LARGE");
  assert.deepEqual(await f.state(), { stock: 5, reserved: 0, orders: 0 });
});

test("HTTP checkout cannot accept injected ownership/prices, duplicate lines or missing terms", async (t) => {
  const f = await fixture(t);
  for (const payload of [
    { ...f.input, customerId: randomUUID() },
    { ...f.input, priceCents: 1 },
    { ...f.input, lines: [...f.input.lines, ...f.input.lines] },
    { ...f.input, termsAccepted: false },
  ]) {
    const response = await checkoutPost(f.request(payload));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "VALIDATION");
  }
  const changed = await checkoutPost(
    f.request({ ...f.input, expectedTotalCents: 1 }),
  );
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).code, "PRICE_CHANGED");
  const terms = await checkoutPost(
    f.request({ ...f.input, termsVersion: "stale-synthetic" }),
  );
  assert.equal(terms.status, 409);
  assert.equal((await terms.json()).code, "TERMS_CHANGED");
  assert.deepEqual(await f.state(), { stock: 5, reserved: 0, orders: 0 });
});

test("checkout HTTP rate limit rejects the eleventh request before mutation and recovers after expiry", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++)
    assert.equal(
      (await checkoutPost(f.request({}, undefined, "{"))).status,
      400,
    );
  const blocked = await checkoutPost(f.request());
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, "RATE_LIMIT");
  assert.deepEqual(await f.state(), { stock: 5, reserved: 0, orders: 0 });
  const key = createHash("sha256").update(`checkout:${f.ip}`).digest("hex");
  await query(
    "UPDATE rate_limits SET expires_at=now()-interval '1 second' WHERE key=$1",
    [key],
  );
  assert.equal((await checkoutPost(f.request())).status, 201);
});

test("cart HTTP quotes current availability and omits withdrawn products before checkout", async (t) => {
  const f = await fixture(t);
  await query("UPDATE products SET reserved=2 WHERE id=$1", [f.product.id]);
  const withdrawn = (
    await query(
      "INSERT INTO products(slug,name,price_cents,stock,status,sale_mode) VALUES($1,'Synthetic withdrawn',100,5,'archived','retail') RETURNING id",
      [randomUUID()],
    )
  ).rows[0];
  const response = await cartPost(
    new Request(`${process.env.APP_URL}/api/cart`, {
      method: "POST",
      headers: {
        origin: new URL(process.env.APP_URL!).origin,
        "content-type": "application/json",
        "x-real-ip": f.ip,
      },
      body: JSON.stringify({ ids: [f.product.id, withdrawn.id, randomUUID()] }),
    }),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  const { products } = await response.json();
  assert.equal(products.length, 1);
  assert.equal(products[0].id, f.product.id);
  assert.equal(products[0].available, 3);
  assert.equal(products[0].priceCents, 8000);
  assert.equal("reserved" in products[0], false);
});

test("the checkout runner blocks provider fetches and TCP before connection", async () => {
  assert.throws(() => net.connect(443, "checkout.stripe.com"), /blocked/);
  assert.throws(() => net.connect(55449, "127.0.0.1"), /blocked/);
  await assert.rejects(fetch("https://www.apaczka.pl/"), /blocked/);
  for (const override of [
    { DATABASE_URL: "postgres://synthetic:do-not-print@example.test/client" },
    { PGDATABASE: "client_store" },
    { PGHOST: "remote.example.test" },
    { PGPORT: "" },
  ]) {
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "./tests/helpers/checkout-network-isolation.mjs",
        "--eval",
        "console.log('UNREACHABLE_AFTER_GUARD')",
      ],
      {
        env: {
          ...process.env,
          PGHOST: checkoutNetworkIsolation.databaseHost,
          ...override,
        },
        encoding: "utf8",
      },
    );
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /Checkout regression requires/);
    assert.equal(child.stdout.includes("UNREACHABLE_AFTER_GUARD"), false);
    assert.equal(child.stderr.includes("do-not-print"), false);
  }
});
