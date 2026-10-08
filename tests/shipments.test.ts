import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, query } from "../lib/server/db";
import { createApaczkaClient } from "../lib/server/apaczka";
import {
  createShipment,
  cancelShipment,
  shipmentPending,
  shipmentLabel,
  activeShipment,
  quoteShipment,
} from "../lib/server/shipments";
if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error("Dedicated test database required");
after(async () => database().end());
const service = {
  service_id: "1",
  name: "Synthetic courier",
  domestic: "1",
  door_to_door: "1",
  pickup_courier: "1",
};
function configure(t: TestContext) {
  const keys = [
    "APACZKA_APP_ID",
    "APACZKA_APP_SECRET",
    "APACZKA_MODE",
    "APACZKA_LIVE_SHIPPING_ENABLED",
  ];
  const previous = keys.map((key) => process.env[key]);
  process.env.APACZKA_APP_ID = "test-app";
  process.env.APACZKA_APP_SECRET = "test-secret";
  process.env.APACZKA_MODE = "sandbox";
  process.env.APACZKA_LIVE_SHIPPING_ENABLED = "false";
  t.after(() => {
    for (const [i, key] of keys.entries()) {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    }
  });
}
const input = { serviceId: "1", presetId: "karton-4" };
test("provider modes cannot fetch or cancel another environment's shipment", async (t) => {
  configure(t);
  const id = await order(),
    mock = mockClient();
  const created = await createShipment(id, input, "test-admin", mock.client);
  assert.equal(created.mode, "sandbox");
  assert.equal(
    (await query("SELECT tracking_number FROM orders WHERE id=$1", [id]))
      .rows[0].tracking_number,
    null,
  );
  process.env.APACZKA_MODE = "live";
  process.env.APACZKA_LIVE_SHIPPING_ENABLED = "true";
  const preview = process.env.STOREFRONT_PREVIEW;
  process.env.STOREFRONT_PREVIEW = "false";
  t.after(() => {
    if (preview === undefined) delete process.env.STOREFRONT_PREVIEW;
    else process.env.STOREFRONT_PREVIEW = preview;
  });
  assert.equal(await activeShipment(id), null);
  await assert.rejects(shipmentLabel(id, "test-admin", mock.client), {
    code: "SHIPMENT_MISSING",
  });
  await assert.rejects(cancelShipment(id, "test-admin", mock.client), {
    code: "SHIPMENT_MISSING",
  });
  const quoted = await quoteShipment(id, input, "test-admin", mock.client);
  await createShipment(
    id,
    { ...input, quoteId: quoted.quoteId },
    "test-admin",
    mock.client,
  );
  assert.equal((await activeShipment(id))!.mode, "live");
  await query("UPDATE orders SET tracking_number='LIVE-REAL' WHERE id=$1", [
    id,
  ]);
  process.env.APACZKA_MODE = "sandbox";
  await shipmentLabel(id, "test-admin", mock.client);
  await cancelShipment(id, "test-admin", mock.client);
  await createShipment(id, input, "test-admin", mock.client);
  assert.equal(
    (await query("SELECT tracking_number FROM orders WHERE id=$1", [id]))
      .rows[0].tracking_number,
    "LIVE-REAL",
  );
  await query(
    "UPDATE shipments SET status='cancelled' WHERE order_id=$1 AND id<>$2 AND mode='sandbox'",
    [id, created.id],
  );
  await query("UPDATE shipments SET status='created' WHERE id=$1", [
    created.id,
  ]);
  process.env.APACZKA_MODE = "live";
  // Provider identifiers can overlap without crossing the environment boundary.
  await query(
    "UPDATE shipments SET provider_order_id=$2 WHERE order_id=$1 AND mode='live'",
    [id, created.provider_order_id],
  );
  assert.equal(
    (
      await query("SELECT count(*)::int n FROM shipments WHERE order_id=$1", [
        id,
      ])
    ).rows[0].n,
    3,
  );
  await query(
    "UPDATE shipments SET status='cancelled' WHERE order_id=$1 AND mode='live'",
    [id],
  );
  await query("UPDATE shipments SET mode='unknown' WHERE id=$1", [created.id]);
  await assert.rejects(shipmentLabel(id, "test-admin", mock.client), {
    code: "SHIPMENT_MODE",
  });
  await assert.rejects(cancelShipment(id, "test-admin", mock.client), {
    code: "SHIPMENT_MODE",
  });
});
test("refund or warehouse adjustments block sending an unchanged full-value parcel", async (t) => {
  configure(t);
  for (const kind of ["record_refund", "record_return"]) {
    const id = await order(),
      mock = mockClient();
    await query(
      "INSERT INTO order_events(order_id,event_key,kind,data) VALUES($1,$2,$3,'{}')",
      [id, randomUUID(), kind],
    );
    await assert.rejects(createShipment(id, input, "test-admin", mock.client), {
      code: "SHIPMENT_ADJUSTED_ORDER",
    });
    assert.equal(mock.sends(), 0);
  }
});
async function order(status = "processing") {
  return (
    await query(
      "INSERT INTO orders(email,buyer,shipping_address,status,payment_method,subtotal_cents,shipping_cents,total_cents,shipping_method,shipping_label,terms_version,stock_committed) VALUES($1,$2,$3,$4,'bank_transfer',10000,1500,11500,'courier','Courier','test',$5) RETURNING id",
      [
        "buyer@example.test",
        JSON.stringify({
          firstName: "Test",
          lastName: "Buyer",
          phone: "123456789",
        }),
        JSON.stringify({
          street: "Test 1",
          postalCode: "00-001",
          city: "Warszawa",
          country: "PL",
        }),
        status,
        ["paid", "processing"].includes(status),
      ],
    )
  ).rows[0].id as string;
}
function mockClient(failSend = false) {
  let sends = 0;
  const client = createApaczkaClient(async (url) => {
    const route = String(url).split("/api/v2/")[1];
    let response: unknown = [];
    if (route === "service_structure/") response = { services: [service] };
    if (route === "order_valuation/")
      response = { price_table: { "1": { price: 2000, price_gross: 2460 } } };
    if (route === "order_send/") {
      sends++;
      if (failSend) throw new Error("lost connection");
      response = { order: { id: randomUUID(), waybill_number: "WB123" } };
    }
    if (route.startsWith("waybill/"))
      response = {
        type: "pdf",
        waybill: Buffer.from("%PDF-1.4\ntest").toString("base64"),
      };
    return Response.json({ status: 200, response });
  });
  return { client, sends: () => sends };
}
test("unpaid, uncommitted and pickup orders cannot submit a courier request", async (t) => {
  configure(t);
  const mock = mockClient();
  await assert.rejects(
    createShipment(
      await order("pending_payment"),
      input,
      "test-admin",
      mock.client,
    ),
    { code: "SHIPMENT_ORDER" },
  );
  const uncommitted = await order("paid");
  await query("UPDATE orders SET stock_committed=false WHERE id=$1", [
    uncommitted,
  ]);
  await assert.rejects(
    createShipment(uncommitted, input, "test-admin", mock.client),
    { code: "SHIPMENT_ORDER" },
  );
  const pickup = await order();
  await query("UPDATE orders SET shipping_method='pickup-kielce' WHERE id=$1", [
    pickup,
  ]);
  await assert.rejects(
    createShipment(pickup, input, "test-admin", mock.client),
    { code: "SHIPMENT_PICKUP_ORDER" },
  );
  assert.equal(mock.sends(), 0);
});
test("a quote never sends, binds all parcels and its actor, expires and cannot cross environments", async (t) => {
  configure(t);
  const id = await order(),
    mock = mockClient();
  const parcels = [
    { lengthCm: 30, widthCm: 20, heightCm: 25, weightKg: 6 },
    { lengthCm: 30, widthCm: 20, heightCm: 25, weightKg: 6 },
  ];
  const p = { serviceId: "1", parcels };
  const quote = await quoteShipment(id, p, "test-admin", mock.client);
  assert.equal(quote.parcelsCount, 2);
  assert.equal(quote.grossCents, 2460);
  assert.equal(mock.sends(), 0);
  const quoted = { ...p, quoteId: quote.quoteId };
  await assert.rejects(createShipment(id, quoted, "other-admin", mock.client), {
    code: "SHIPMENT_QUOTE_REQUIRED",
  });
  await assert.rejects(
    createShipment(
      id,
      { ...quoted, parcels: [{ ...parcels[0], weightKg: 7 }] },
      "test-admin",
      mock.client,
    ),
    { code: "SHIPMENT_QUOTE_REQUIRED" },
  );
  await query(
    "UPDATE order_events SET data=jsonb_set(data,'{expiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE event_key=$1",
    [quote.quoteId],
  );
  await assert.rejects(createShipment(id, quoted, "test-admin", mock.client), {
    code: "SHIPMENT_QUOTE_REQUIRED",
  });
  const fresh = await quoteShipment(id, p, "test-admin", mock.client);
  const oldPreview = process.env.STOREFRONT_PREVIEW;
  t.after(() => {
    if (oldPreview === undefined) delete process.env.STOREFRONT_PREVIEW;
    else process.env.STOREFRONT_PREVIEW = oldPreview;
  });
  process.env.STOREFRONT_PREVIEW = "false";
  process.env.APACZKA_LIVE_SHIPPING_ENABLED = "true";
  process.env.APACZKA_MODE = "live";
  await assert.rejects(
    createShipment(
      id,
      { ...p, quoteId: fresh.quoteId },
      "test-admin",
      mock.client,
    ),
    { code: "SHIPMENT_QUOTE_REQUIRED" },
  );
  await assert.rejects(createShipment(id, p, "test-admin", mock.client), {
    code: "SHIPMENT_QUOTE_REQUIRED",
  });
  assert.equal(mock.sends(), 0);
  process.env.APACZKA_MODE = "sandbox";
  await createShipment(
    id,
    { ...p, quoteId: fresh.quoteId },
    "test-admin",
    mock.client,
  );
  assert.equal(mock.sends(), 1);
  assert.equal(
    (
      await query(
        "SELECT jsonb_array_length(parcel) AS n FROM shipments WHERE order_id=$1",
        [id],
      )
    ).rows[0].n,
    2,
  );
});
test("concurrent and repeated send rejected; cancellation changes status, history and tracking", async (t) => {
  configure(t);
  const id = await order(),
    mock = mockClient();
  const results = await Promise.allSettled([
    createShipment(id, input, "test-admin", mock.client),
    createShipment(id, input, "test-admin", mock.client),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(mock.sends(), 1);
  await assert.rejects(createShipment(id, input, "test-admin", mock.client), {
    code: "SHIPMENT_EXISTS",
  });
  assert.equal(
    (await query("SELECT tracking_number FROM orders WHERE id=$1", [id]))
      .rows[0].tracking_number,
    null,
  );
  assert.match(
    (await shipmentLabel(id, "test-admin", mock.client)).toString(),
    /^%PDF-/,
  );
  await cancelShipment(id, "test-admin", mock.client);
  const s = (
    await query("SELECT status,cancelled_at FROM shipments WHERE order_id=$1", [
      id,
    ])
  ).rows[0];
  assert.equal(s.status, "cancelled");
  assert.ok(s.cancelled_at);
  assert.equal(
    (await query("SELECT tracking_number FROM orders WHERE id=$1", [id]))
      .rows[0].tracking_number,
    null,
  );
  assert.equal(
    (
      await query(
        "SELECT count(*)::int n FROM audit_log WHERE entity_id=$1 AND action='shipment.cancelled'",
        [id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await query(
        "SELECT count(*)::int n FROM order_events WHERE order_id=$1 AND kind='shipment_cancelled'",
        [id],
      )
    ).rows[0].n,
    1,
  );
  await createShipment(id, input, "test-admin", mock.client);
  assert.equal(mock.sends(), 2);
});
test("uncertain send stays blocked, invalid order statuses never send", async (t) => {
  configure(t);
  const id = await order(),
    mock = mockClient(true);
  await assert.rejects(createShipment(id, input, "test-admin", mock.client), {
    code: "APACZKA_UNCERTAIN",
  });
  assert.equal(await shipmentPending(id), true);
  await assert.rejects(createShipment(id, input, "test-admin", mock.client), {
    code: "SHIPMENT_PENDING",
  });
  assert.equal(mock.sends(), 1);
  for (const status of ["cancelled", "legacy", "refunded"])
    await assert.rejects(
      createShipment(await order(status), input, "test-admin", mock.client),
      { code: "SHIPMENT_ORDER" },
    );
});

test("uncertain cancellation stays locally active and blocks repeated remote cancellation", async (t) => {
  configure(t);
  const id = await order(),
    mock = mockClient();
  await createShipment(id, input, "test-admin", mock.client);
  let attempts = 0;
  const failing = {
    ...mock.client,
    cancelOrder: async () => {
      attempts++;
      const { StoreError } = await import("../lib/server/errors");
      throw new StoreError("APACZKA_UNCERTAIN", "Synthetic timeout", 502);
    },
  };
  await assert.rejects(cancelShipment(id, "test-admin", failing), {
    code: "APACZKA_UNCERTAIN",
  });
  await assert.rejects(cancelShipment(id, "test-admin", failing), {
    code: "SHIPMENT_PENDING",
  });
  assert.equal(attempts, 1);
  assert.equal(await shipmentPending(id), true);
  assert.equal(
    (await query("SELECT status FROM shipments WHERE order_id=$1", [id]))
      .rows[0].status,
    "created",
  );
});
