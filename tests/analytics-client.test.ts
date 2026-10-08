import test from "node:test";
import assert from "node:assert/strict";
import { item } from "../lib/analytics";
test("client ecommerce uses net line value matching purchase VAT rounding", () => {
  for (const [priceCents, taxRate, quantity] of [
    [8000, 23, 1],
    [999, 23, 3],
    [12345, 8, 7],
    [2345, 0, 2],
  ]) {
    const p = {
      id: "synthetic",
      sku: "TEST",
      name: "Test",
      priceCents,
      taxRate,
    };
    const result = item(p, quantity);
    assert.equal(
      Math.round(result.price * result.quantity * 100),
      Math.round((priceCents * quantity * 100) / (100 + taxRate)),
    );
  }
});
