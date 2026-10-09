import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  createApaczkaClient,
  apaczkaSignature,
  apaczkaConfigured,
  parseApaczkaValuation,
} from "../lib/server/apaczka";
import { mapShipmentOrder, shipmentInput } from "../lib/server/shipments";
import { settingsSchema } from "../lib/server/settings";
const settings = settingsSchema.parse({
  checkoutEnabled: false,
  shippingApproved: false,
  legalApproved: false,
  termsVersion: "pending",
  shippingMethods: [],
  paymentMethods: [],
  bankAccount: "PL 12 3456 7890 1234 5678 9012 3456",
  orderEmail: "store@example.test",
  contactEmail: "contact@example.test",
});
const service = {
  service_id: "1",
  name: "Test courier",
  domestic: "1",
  door_to_door: "1",
  pickup_courier: "1",
};
const source = {
  email: "buyer@example.test",
  currency: "PLN",
  total_cents: 12345,
  payment_method: "cod",
  buyer: { firstName: "Test", lastName: "Buyer", phone: "+48 123 456 789" },
  shipping_address: {
    street: "Test 1",
    postalCode: "00-001",
    city: "Warszawa",
    country: "PL",
  },
};
const parcel = { lengthCm: 30, widthCm: 20, heightCm: 25, weightKg: 5 };
test("valuation selects the requested service in grosze and rejects missing or malformed prices", () => {
  assert.deepEqual(
    parseApaczkaValuation(
      {
        price_table: {
          "1": { price: 2000, price_gross: 2460 },
          "2": { price: 100, price_gross: 123 },
        },
      },
      "1",
    ),
    { netCents: 2000, grossCents: 2460 },
  );
  for (const raw of [
    {},
    { price_table: {} },
    { price_table: { "1": { price: -1, price_gross: 10 } } },
    { price_table: { "1": { price: 20, price_gross: "24.60" } } },
  ])
    assert.throws(() => parseApaczkaValuation(raw, "1"), {
      code: "APACZKA_VALUATION",
    });
  const mapped = mapShipmentOrder(source, settings, service, [
    parcel,
    { ...parcel, weightKg: 6 },
  ]);
  assert.equal(mapped.shipment.length, 2);
  assert.deepEqual(
    mapped.shipment.map((p) => p.weight),
    [5, 6],
  );
  assert.equal(mapped.cod?.amount, source.total_cents);
  assert.equal(
    shipmentInput.safeParse({ serviceId: "1", parcels: [] }).success,
    false,
  );
  assert.equal(
    shipmentInput.safeParse({ serviceId: "1", parcel, parcels: [parcel] })
      .success,
    false,
  );
});
function configure(t: TestContext, enabled = true) {
  const keys = [
    "APACZKA_APP_ID",
    "APACZKA_APP_SECRET",
    "APACZKA_MODE",
    "APACZKA_LIVE_SHIPPING_ENABLED",
    "STOREFRONT_PREVIEW",
  ];
  const previous = keys.map((key) => process.env[key]);
  process.env.APACZKA_APP_ID = enabled ? "test-app" : "";
  process.env.APACZKA_APP_SECRET = enabled ? "test-secret" : "";
  process.env.APACZKA_MODE = "sandbox";
  process.env.APACZKA_LIVE_SHIPPING_ENABLED = "false";
  process.env.STOREFRONT_PREVIEW = "true";
  t.after(() => {
    for (const [i, key] of keys.entries()) {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    }
  });
}
const ok = (response: unknown) =>
  Response.json({ status: 200, message: "", response });
test("live shipping fails before any provider call; read-only services remain available", async (t) => {
  configure(t);
  process.env.APACZKA_MODE = "live";
  let calls = 0;
  const client = createApaczkaClient(async () => {
    calls++;
    return ok({ services: [service] });
  });
  await client.services();
  assert.equal(calls, 1);
  await assert.rejects(
    client.sendOrder(mapShipmentOrder(source, settings, service, parcel)),
    { code: "APACZKA_LIVE_DISABLED" },
  );
  await assert.rejects(client.cancelOrder("123"), {
    code: "APACZKA_LIVE_DISABLED",
  });
  assert.equal(calls, 1);
});
test("preview blocks live sending and cancellation even with the live switch enabled, while reads remain available", async (t) => {
  configure(t);
  process.env.APACZKA_MODE = "live";
  process.env.APACZKA_LIVE_SHIPPING_ENABLED = "true";
  const routes: string[] = [];
  const client = createApaczkaClient(async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, "https://www.apaczka.pl");
    routes.push(parsed.pathname);
    if (parsed.pathname === "/api/v2/service_structure/")
      return ok({ services: [service] });
    assert.equal(parsed.pathname, "/api/v2/order_valuation/");
    return ok({ price_table: { "1": { price: 2000, price_gross: 2460 } } });
  });
  const order = mapShipmentOrder(source, settings, service, parcel);
  await assert.rejects(client.sendOrder(order), {
    code: "APACZKA_LIVE_DISABLED",
  });
  await assert.rejects(client.cancelOrder("123"), {
    code: "APACZKA_LIVE_DISABLED",
  });
  assert.deepEqual(routes, []);
  assert.deepEqual(await client.services(), [service]);
  assert.deepEqual(parseApaczkaValuation(await client.valuation(order), "1"), {
    netCents: 2000,
    grossCents: 2460,
  });
  assert.deepEqual(routes, [
    "/api/v2/service_structure/",
    "/api/v2/order_valuation/",
  ]);
});
test("service caches are separated by environment and sandbox never targets production", async (t) => {
  configure(t);
  const hosts: string[] = [];
  const client = createApaczkaClient(async (url) => {
    hosts.push(new URL(String(url)).hostname);
    return ok({ services: [service] });
  });
  await client.services();
  process.env.APACZKA_MODE = "live";
  await client.services();
  assert.deepEqual(hosts, ["panel-sandbox.apaczka.pl", "www.apaczka.pl"]);
  process.env.APACZKA_MODE = "invalid";
  await assert.rejects(client.services(), { code: "APACZKA_MODE" });
});
test("signature: fixed independent HMAC-SHA256 vector and exact form bytes", async (t) => {
  configure(t);
  // Independently calculated with Python hmac/sha256 over the literal UTF-8 message:
  // test-app:order_send/:{"order":{"service_id":1}}:1700000300
  assert.equal(
    apaczkaSignature(
      "test-app",
      "order_send/",
      '{"order":{"service_id":1}}',
      1700000300,
      "test-secret",
    ),
    "7af816444c399963859f5d300977222e1c27a429f61e0c72053f755b2281bebd",
  );
  let calls = 0;
  const client = createApaczkaClient(async (url, init) => {
    calls++;
    assert.equal(
      String(url),
      "https://panel-sandbox.apaczka.pl/api/v2/service_structure/",
    );
    assert.equal(init?.method, "POST");
    assert.equal(init?.cache, "no-store");
    const body = init!.body as URLSearchParams;
    assert.equal(body.get("request"), "[]");
    assert.equal(
      body.get("signature"),
      apaczkaSignature(
        "test-app",
        "service_structure/",
        "[]",
        Number(body.get("expires")),
        "test-secret",
      ),
    );
    return ok({ services: [service] });
  });
  await Promise.all([client.services(), client.services()]);
  await client.services();
  assert.equal(calls, 1);
});
test("sendOrder maps addresses, dimensions, gross COD cents and NRB", async (t) => {
  configure(t);
  const order = mapShipmentOrder(source, settings, service, parcel);
  const client = createApaczkaClient(async (url, init) => {
    assert.equal(
      String(url),
      "https://panel-sandbox.apaczka.pl/api/v2/order_send/",
    );
    const payload = JSON.parse((init!.body as URLSearchParams).get("request")!);
    assert.deepEqual(payload.order.cod, {
      amount: 12345,
      currency: "PLN",
      bankaccount: "12345678901234567890123456",
    });
    assert.deepEqual(payload.order.shipment, [
      {
        dimension1: 30,
        dimension2: 20,
        dimension3: 25,
        weight: 5,
        is_nstd: 0,
        shipment_type_code: "PACZKA",
      },
    ]);
    assert.equal(payload.order.address.receiver.line1, "Test 1");
    assert.equal(payload.order.address.receiver.contact_person, "Test Buyer");
    assert.equal(payload.order.address.receiver.phone, "+48123456789");
    assert.equal(payload.order.address.sender.line1, "ul. Okrzei 64/74");
    assert.deepEqual(payload.order.pickup, { type: "SELF" });
    assert.equal(payload.order.is_zebra, 0);
    return ok({
      order: {
        id: 42,
        waybill_number: "WB42",
        tracking_url: "https://example.test/42",
      },
    });
  });
  assert.deepEqual(await client.sendOrder(order), {
    apaczkaOrderId: "42",
    waybillNumber: "WB42",
    trackingUrl: "https://example.test/42",
  });
  assert.equal(
    mapShipmentOrder(
      { ...source, payment_method: "bank_transfer" },
      settings,
      service,
      parcel,
    ).cod,
    undefined,
  );
});
test("disabled integration never calls fetch", async (t) => {
  configure(t, false);
  assert.equal(apaczkaConfigured(), false);
  const client = createApaczkaClient(async () => {
    throw new Error("must not fetch");
  });
  await assert.rejects(
    client.sendOrder(mapShipmentOrder(source, settings, service, parcel)),
    { code: "APACZKA_DISABLED" },
  );
  await assert.rejects(client.services(), { code: "APACZKA_DISABLED" });
});
test("provider errors redact private messages; transport failures are uncertain", async (t) => {
  configure(t);
  const client = createApaczkaClient(async () =>
    Response.json({
      status: 400,
      message: "secret and recipient",
      response: {},
    }),
  );
  await assert.rejects(client.cancelOrder("42"), (e) => {
    assert.equal((e as { code: string }).code, "APACZKA_REJECTED");
    assert.doesNotMatch(String(e), /secret|recipient/);
    return true;
  });
  const broken = createApaczkaClient(async () => {
    throw new Error("sensitive network failure");
  });
  await assert.rejects(broken.cancelOrder("42"), { code: "APACZKA_UNCERTAIN" });
});
test("PDF decoding, order lookup, valuation and cancellation use documented routes", async (t) => {
  configure(t);
  const routes: string[] = [];
  const client = createApaczkaClient(async (url, init) => {
    const route = String(url).split("/api/v2/")[1];
    routes.push(route);
    if (route === "waybill/42/")
      return ok({
        type: "pdf",
        waybill: Buffer.from("%PDF-1.4\ntest").toString("base64"),
      });
    if (route === "order/42/")
      return ok({ order: { id: "42", waybill_number: "WB42" } });
    if (route === "order_valuation/") {
      assert.ok(
        JSON.parse((init!.body as URLSearchParams).get("request")!).order,
      );
      return ok({ price_table: {} });
    }
    assert.equal((init!.body as URLSearchParams).get("request"), "[]");
    return ok([]);
  });
  assert.match((await client.waybillPdf("42")).toString(), /^%PDF-/);
  assert.equal((await client.order("42")).waybill_number, "WB42");
  await client.valuation(mapShipmentOrder(source, settings, service, parcel));
  await client.cancelOrder("42");
  assert.deepEqual(routes, [
    "waybill/42/",
    "order/42/",
    "order_valuation/",
    "cancel_order/42/",
  ]);
  const invalid = createApaczkaClient(async () =>
    ok({ type: "pdf", waybill: Buffer.from("html").toString("base64") }),
  );
  await assert.rejects(invalid.waybillPdf("42"), { code: "APACZKA_LABEL" });
});
test("old settings receive defaults and invalid parcel/pickup/bank inputs are rejected", () => {
  assert.equal(settings.sender.phone, "602 155 919");
  assert.equal(settings.parcelPresets[0].weightKg, 5);
  assert.equal(
    shipmentInput.safeParse({ serviceId: "1", parcel, presetId: "both" })
      .success,
    false,
  );
  assert.equal(
    shipmentInput.safeParse({
      serviceId: "1",
      parcel: { ...parcel, lengthCm: -1 },
    }).success,
    false,
  );
  assert.equal(
    shipmentInput.safeParse({
      serviceId: "1",
      parcel,
      pickupDate: "2026-02-30",
    }).success,
    false,
  );
  assert.throws(
    () =>
      mapShipmentOrder(
        source,
        { ...settings, bankAccount: "" },
        service,
        parcel,
      ),
    { code: "SHIPMENT_BANK" },
  );
  assert.throws(
    () =>
      mapShipmentOrder(
        source,
        settings,
        { ...service, pickup_courier: "2" },
        parcel,
      ),
    { code: "SHIPMENT_PICKUP" },
  );
});

test("pickup hours are selected from the provider and cached for subsequent dates", async (t) => {
  configure(t);
  let count = 0;
  const client = createApaczkaClient(async (url, init) => {
    count++;
    assert.equal(
      String(url),
      "https://panel-sandbox.apaczka.pl/api/v2/pickup_hours/",
    );
    assert.deepEqual(
      JSON.parse((init!.body as URLSearchParams).get("request")!),
      { postal_code: "25-526", service_id: 1, remove_index: false },
    );
    return ok({
      hours: {
        "2026-10-02": {
          services: [{ service: 1, timefrom: "09:00", timeto: "12:00" }],
        },
      },
    });
  });
  assert.deepEqual(await client.pickupHours("25-526", "1", "2026-10-02"), {
    hours_from: "09:00",
    hours_to: "12:00",
  });
  await assert.rejects(client.pickupHours("25-526", "1", "2026-10-03"), {
    code: "APACZKA_PICKUP",
  });
  assert.equal(count, 1);
});
test("a request aborts after 15 seconds without retry", async (t) => {
  configure(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const client = createApaczkaClient(async (_url, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) =>
      init!.signal!.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        { once: true },
      ),
    );
  });
  const result = assert.rejects(client.cancelOrder("42"), {
    code: "APACZKA_UNCERTAIN",
  });
  t.mock.timers.tick(15000);
  await result;
  assert.equal(calls, 1);
});
