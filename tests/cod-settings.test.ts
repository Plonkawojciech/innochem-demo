import test from "node:test";
import assert from "node:assert/strict";
import { settingsSchema } from "../lib/server/settings";
import { legalCommerce, legalHash } from "../lib/server/legal";
const legacy = {
  checkoutEnabled: false,
  shippingApproved: false,
  legalApproved: false,
  termsVersion: "pending",
  shippingMethods: [],
  paymentMethods: [],
  bankAccount: "",
  orderEmail: "synthetic@example.test",
  contactEmail: "synthetic@example.test",
};
test("legacy store settings default to unlimited COD; limits require integer cents within range", () => {
  assert.equal(settingsSchema.parse(legacy).codLimitCents, 0);
  for (const codLimitCents of [0, 1, 10_000_000])
    assert.equal(
      settingsSchema.parse({ ...legacy, codLimitCents }).codLimitCents,
      codLimitCents,
    );
  for (const codLimitCents of [-1, 1.5, 10_000_001])
    assert.equal(
      settingsSchema.safeParse({ ...legacy, codLimitCents }).success,
      false,
    );
});
test("COD limit changes the legal commerce hash", () => {
  const settings = settingsSchema.parse(legacy);
  assert.notEqual(
    legalHash([], legalCommerce(settings)),
    legalHash([], legalCommerce({ ...settings, codLimitCents: 10000 })),
  );
});
