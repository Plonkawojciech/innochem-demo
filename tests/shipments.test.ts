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
  const previous = [process.env.APACZKA_APP_ID, process.env.APACZKA_APP_SECRET];
  process.env.APACZKA_APP_ID = "test-app";
  process.env.APACZKA_APP_SECRET = "test-secret";
  t.after(() => {
    for (const [i, key] of ["APACZKA_APP_ID", "APACZKA_APP_SECRET"].entries()) {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    }
  });
}
const input = { serviceId: "1", presetId: "karton-4" };
async function order(status = "processing") {
  return (
    await query(
      "INSERT INTO orders(email,buyer,shipping_address,status,payment_method,subtotal_cents,shipping_cents,total_cents,shipping_method,shipping_label,terms_version) VALUES($1,$2,$3,$4,'bank_transfer',10000,1500,11500,'courier','Courier','test') RETURNING id",
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
    "WB123",
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
