import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, query } from "../lib/server/db";
import {
  createOrder,
  markOrderPaid,
  cancelPendingOrder,
  accessibleOrder,
  StoreError,
} from "../lib/server/orders";
import { deliverMailBatch } from "../lib/server/mail";
import { legalCommerce, legalHash } from "../lib/server/legal";
import { settingsSchema } from "../lib/server/settings";

if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error(
    "Integration tests require a dedicated innochem_test_* database",
  );
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
const stock = async (id: string) =>
  (await query("SELECT stock,reserved FROM products WHERE id=$1", [id]))
    .rows[0];
test("two buyers cannot reserve the same last unit", async () => {
  const input = await fixture(1);
  const second = { ...input, idempotencyKey: randomUUID() };
  const results = await Promise.allSettled([
    createOrder(input),
    createOrder(second),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const failure = results.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  assert.equal(failure.reason.code, "OUT_OF_STOCK");
  assert.deepEqual(await stock(input.lines[0].productId), {
    stock: 1,
    reserved: 1,
  });
});
test("concurrent retries create one order, reservation and notification pair", async () => {
  const input = await fixture();
  const [first, second] = await Promise.all([
    createOrder(input),
    createOrder(input),
  ]);
  assert.equal(first.id, second.id);
  assert.equal(first.accessToken, second.accessToken);
  assert.deepEqual(await stock(input.lines[0].productId), {
    stock: 5,
    reserved: 1,
  });
  assert.equal(
    (
      await query(
        "SELECT count(*)::int AS n FROM mail_outbox WHERE event_key LIKE $1",
        [`order:${first.id}:%`],
      )
    ).rows[0].n,
    2,
  );
  await assert.rejects(
    createOrder({ ...input, buyer: { ...input.buyer, firstName: "Changed" } }),
    (e) => e instanceof StoreError && e.code === "IDEMPOTENCY_CONFLICT",
  );
});
test("changed prices reject checkout without reserving stock", async () => {
  const input = await fixture();
  await assert.rejects(
    createOrder({ ...input, expectedTotalCents: 1 }),
    (e) => e instanceof StoreError && e.code === "PRICE_CHANGED",
  );
  assert.deepEqual(await stock(input.lines[0].productId), {
    stock: 5,
    reserved: 0,
  });
  assert.equal(
    (
      await query(
        "SELECT count(*)::int AS n FROM orders WHERE idempotency_key=$1",
        [input.idempotencyKey],
      )
    ).rows[0].n,
    0,
  );
});
test("invalid payload cannot set price, customer ownership or accept terms implicitly", async () => {
  const input = await fixture();
  await assert.rejects(createOrder({ ...input, price: 1 }));
  await assert.rejects(createOrder({ ...input, termsAccepted: false }));
  await assert.rejects(createOrder({ ...input, customerId: randomUUID() }));
  await assert.rejects(
    createOrder({ ...input, lines: [...input.lines, ...input.lines] }),
  );
  assert.deepEqual(await stock(input.lines[0].productId), {
    stock: 5,
    reserved: 0,
  });
});
test("industrial inquiry products cannot enter checkout", async () => {
  const input = await fixture(10, "inquiry");
  await assert.rejects(
    createOrder(input),
    (e) => e instanceof StoreError && e.code === "PRODUCT_UNAVAILABLE",
  );
});
test("checkout remains closed while commercial decisions are not approved", async () => {
  const input = await fixture();
  await query(
    "UPDATE settings SET value=jsonb_set(value,'{shippingApproved}','false') WHERE key='store'",
  );
  await assert.rejects(
    createOrder(input),
    (e) => e instanceof StoreError && e.code === "CHECKOUT_UNAVAILABLE",
  );
});
test("payment amount mismatch has no stock or order side effect", async () => {
  const input = await fixture();
  const order = await createOrder(input);
  await assert.rejects(
    markOrderPaid(order.id, "test-" + randomUUID(), 1, "PLN"),
    (e) => e instanceof StoreError && e.code === "PAYMENT_MISMATCH",
  );
  assert.deepEqual(await stock(input.lines[0].productId), {
    stock: 5,
    reserved: 1,
  });
});
test("repeated payment confirmation commits stock once", async () => {
  const input = await fixture();
  const order = await createOrder(input);
  const reference = "test-" + randomUUID();
  const result = await Promise.all([
    markOrderPaid(order.id, reference, 9500, "PLN"),
    markOrderPaid(order.id, reference, 9500, "PLN"),
  ]);
  assert.equal(result.filter((r) => r.replayed).length, 1);
  assert.deepEqual(await stock(input.lines[0].productId), {
    stock: 4,
    reserved: 0,
  });
  assert.equal(
    (
      await query(
        "SELECT count(*)::int AS n FROM stock_movements WHERE order_id=$1",
        [order.id],
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    cancelPendingOrder(order.id),
    (e) => e instanceof StoreError && e.code === "INVALID_STATUS",
  );
});
test("cancel releases reservations once; late payment goes to manual review", async () => {
  const input = await fixture();
  const order = await createOrder(input);
  await cancelPendingOrder(order.id);
  await cancelPendingOrder(order.id);
  assert.deepEqual(await stock(input.lines[0].productId), {
    stock: 5,
    reserved: 0,
  });
  const paid = await markOrderPaid(
    order.id,
    "test-" + randomUUID(),
    9500,
    "PLN",
  );
  assert.equal(paid.status, "payment_review");
  assert.deepEqual(await stock(input.lines[0].productId), {
    stock: 5,
    reserved: 0,
  });
});
test("cash on delivery commits stock and cannot be paid twice as online payment", async () => {
  const input = await fixture();
  const order = await createOrder({ ...input, paymentMethod: "cod" });
  assert.deepEqual(await stock(input.lines[0].productId), {
    stock: 4,
    reserved: 0,
  });
  await assert.rejects(
    markOrderPaid(order.id, "test-" + randomUUID(), 9500, "PLN"),
    (e) => e instanceof StoreError && e.code === "INVALID_PAYMENT",
  );
});
test("guest order requires the capability token or its authenticated owner", async () => {
  const input = await fixture();
  const order = await createOrder(input);
  assert.equal(await accessibleOrder(order.id, null), null);
  assert.equal(await accessibleOrder(order.id, null, "invalid"), null);
  assert.equal(await accessibleOrder(order.id, randomUUID()), null);
  assert.equal(
    (await accessibleOrder(order.id, null, order.accessToken))?.order.id,
    order.id,
  );
  const {
    rows: [customer],
  } = await query(
    "INSERT INTO customers(email) VALUES('owner@example.test') RETURNING id",
  );
  const owned = await createOrder(
    { ...input, idempotencyKey: randomUUID() },
    customer.id,
  );
  assert.equal(
    (await accessibleOrder(owned.id, customer.id))?.order.id,
    owned.id,
  );
  assert.equal(await accessibleOrder(owned.id, randomUUID()), null);
});
test("local runs never deliver external mail", async () => {
  assert.notEqual(process.env.MAIL_DELIVERY_ENABLED, "true");
  assert.deepEqual(await deliverMailBatch(), {
    enabled: false,
    sent: 0,
    failed: 0,
    uncertain: 0,
  });
});
test("a weight-limited delivery cannot treat unknown product weights as zero", async () => {
  const input = await fixture();
  await query(
    "UPDATE settings SET value=jsonb_set(value,'{shippingMethods,0,maxWeightGrams}','1000') WHERE key='store'",
  );
  await assert.rejects(
    createOrder(input),
    (e) => e instanceof StoreError && e.code === "SHIPPING_WEIGHT_UNKNOWN",
  );
  assert.deepEqual(await stock(input.lines[0].productId), {
    stock: 5,
    reserved: 0,
  });
});
