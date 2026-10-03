import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  checkoutStorageKey,
  checkoutFingerprint,
  resolveCheckoutKey,
  clearCheckoutKey,
} from "../lib/checkout-key";
const data = {
  cart: { a: 1, b: 2 },
  shippingMethod: "courier",
  paymentMethod: "cod",
  totalCents: 5000,
  termsVersion: "v1",
};
function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
}
test("checkout retries and reloads reuse the key; success clears it", () => {
  const store = storage();
  const fingerprint = checkoutFingerprint(data);
  const first = resolveCheckoutKey(store, fingerprint, null, randomUUID);
  assert.deepEqual(
    resolveCheckoutKey(store, fingerprint, null, randomUUID),
    first,
  );
  assert.equal(
    resolveCheckoutKey(store, fingerprint, first, randomUUID),
    first,
  );
  clearCheckoutKey(store);
  assert.equal(store.getItem(checkoutStorageKey), null);
  assert.notEqual(
    resolveCheckoutKey(store, fingerprint, null, randomUUID).key,
    first.key,
  );
});
test("cart ordering is stable and changed checkout data rotates the key", () => {
  const fingerprint = checkoutFingerprint(data);
  assert.equal(
    checkoutFingerprint({ ...data, cart: { b: 2, a: 1 } }),
    fingerprint,
  );
  for (const change of [
    { cart: { a: 2, b: 2 } },
    { shippingMethod: "pickup" },
    { paymentMethod: "bank_transfer" },
    { totalCents: 5001 },
    { termsVersion: "v2" },
  ]) {
    const store = storage();
    const first = resolveCheckoutKey(store, fingerprint, null, randomUUID);
    const changed = checkoutFingerprint({ ...data, ...change });
    assert.notEqual(changed, fingerprint);
    const next = resolveCheckoutKey(store, changed, first, randomUUID);
    assert.notEqual(next.key, first.key);
    assert.deepEqual(JSON.parse(store.getItem(checkoutStorageKey)!), next);
  }
});
test("invalid or blocked storage falls back to an in-memory key", () => {
  const store = storage();
  for (const raw of ["invalid", "null", '{"fingerprint":"x","key":"bad"}']) {
    store.setItem(checkoutStorageKey, raw);
    assert.match(
      resolveCheckoutKey(store, "x", null, randomUUID).key,
      /^[a-f0-9-]{36}$/,
    );
  }
  const blocked = {
    getItem() {
      throw new Error();
    },
    setItem() {
      throw new Error();
    },
    removeItem() {
      throw new Error();
    },
  };
  const first = resolveCheckoutKey(blocked, "x", null, randomUUID);
  assert.equal(resolveCheckoutKey(blocked, "x", first, randomUUID), first);
  assert.doesNotThrow(() => clearCheckoutKey(blocked));
});
