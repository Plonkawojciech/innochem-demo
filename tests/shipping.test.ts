import test from "node:test";
import assert from "node:assert/strict";
import { quoteShipping, shippingKind } from "../lib/shipping";
import { settingsSchema, shippingSchema } from "../lib/server/settings";
import { legalCommerce, legalHash } from "../lib/server/legal";
const courier = shippingSchema.parse({
  id: "courier",
  label: "Kurier",
  kind: "courier",
  priceCents: 2400,
  codPriceCents: 2800,
  freeFromUnits: 12,
  cod: true,
  enabled: true,
  maxWeightGrams: 30000,
});
test("delivery uses prepaid/COD rates and frees exactly twelve mixed retail units", () => {
  for (const payment of ["bank_transfer", "stripe", "cod"] as const) {
    for (const quantity of [1, 6, 11]) {
      const q = quoteShipping(
        courier,
        [{ quantity, weightGrams: 1000 }],
        payment,
      );
      assert.equal(q.priceCents, payment === "cod" ? 2800 : 2400);
      assert.equal(q.remainingUnits, 12 - quantity);
      assert.equal(q.isFree, false);
    }
    for (const quantity of [12, 13]) {
      const q = quoteShipping(
        courier,
        [
          { quantity: 5, weightGrams: 1000 },
          { quantity: quantity - 5, weightGrams: 500 },
        ],
        payment,
      );
      assert.equal(q.priceCents, 0);
      assert.equal(q.remainingUnits, 0);
      assert.equal(q.isFree, true);
    }
  }
});
test("ineligible lines never satisfy the free-shipping quantity", () => {
  const q = quoteShipping(
    courier,
    [
      { quantity: 11, weightGrams: 1000 },
      { quantity: 10, weightGrams: 100, eligible: false },
    ],
    "stripe",
  );
  assert.equal(q.units, 11);
  assert.equal(q.priceCents, 2400);
});
test("free shipping never bypasses unknown weights or limits", () => {
  assert.equal(
    quoteShipping(courier, [{ quantity: 12 }], "cod").error?.code,
    "SHIPPING_WEIGHT_UNKNOWN",
  );
  assert.equal(
    quoteShipping(courier, [{ quantity: 31, weightGrams: 1000 }], "stripe")
      .error?.code,
    "SHIPPING_LIMIT",
  );
  assert.equal(
    quoteShipping(
      courier,
      [{ quantity: 30, weightGrams: 1000 }],
      "bank_transfer",
    ).error,
    null,
  );
});
test("pickup is free and legacy methods retain their rates", () => {
  assert.equal(shippingKind({ id: "pickup-kielce" }), "pickup");
  assert.equal(shippingKind({ id: "odbior-osobisty" }), "pickup");
  assert.equal(
    quoteShipping(
      { ...courier, kind: "pickup" },
      [{ quantity: 999 }],
      "bank_transfer",
    ).priceCents,
    0,
  );
  assert.equal(
    quoteShipping(
      { ...courier, kind: "pickup" },
      [{ quantity: 999 }],
      "bank_transfer",
    ).error,
    null,
  );
  const legacy = shippingSchema.parse({
    id: "old-courier",
    label: "Kurier",
    priceCents: 1500,
    cod: true,
    enabled: true,
  });
  assert.equal(
    quoteShipping(legacy, [{ quantity: 12 }], "cod").priceCents,
    1500,
  );
  assert.equal(
    quoteShipping(legacy, [{ quantity: 12 }], "cod").freeEligible,
    false,
  );
  assert.equal(
    quoteShipping(
      { ...courier, freeShippingIncludesCod: false },
      [{ quantity: 12, weightGrams: 1000 }],
      "cod",
    ).priceCents,
    2800,
  );
});
test("pricing policies are validated and included in immutable legal commerce", () => {
  for (const patch of [
    { codPriceCents: -1 },
    { freeFromUnits: 1.5 },
    { kind: "post" },
  ])
    assert.equal(
      shippingSchema.safeParse({ ...courier, ...patch }).success,
      false,
    );
  const base = settingsSchema.parse({
    shippingMethods: [courier],
    paymentMethods: ["bank_transfer", "cod"],
    bankAccount: "",
    contactEmail: "contact@example.test",
    orderEmail: "store@example.test",
    termsVersion: "test",
    checkoutEnabled: false,
    shippingApproved: false,
    legalApproved: false,
  });
  const hash = legalHash([], legalCommerce(base));
  for (const patch of [
    { codPriceCents: 3000 },
    { freeFromUnits: 13 },
    { freeShippingIncludesCod: false },
  ])
    assert.notEqual(
      hash,
      legalHash(
        [],
        legalCommerce({ ...base, shippingMethods: [{ ...courier, ...patch }] }),
      ),
    );
  assert.equal(
    settingsSchema.safeParse({ ...base, shippingMethods: [courier, courier] })
      .success,
    false,
  );
});
