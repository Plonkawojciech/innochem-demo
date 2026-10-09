import test from "node:test";
import assert from "node:assert/strict";
import {
  createCartConfirmationBridge,
  type CartConfirmation,
} from "../lib/cart-confirmation";
import { addToCart } from "../lib/cart-state";
import type { ProductCardData } from "../lib/store-types";

const product: ProductCardData = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "synthetic",
  name: "Synthetic",
  sku: "SYNTHETIC",
  priceCents: 999,
  taxRate: 23,
  available: 3,
  imagePath: null,
  imageAlt: "",
  saleMode: "retail",
};
const confirmation = (pathname = "/", quantity = 1): CartConfirmation => ({
  product,
  result: addToCart({}, product.id, quantity, product),
  trigger: null,
  pathname,
});

test("an accepted add before mount flushes synchronously once without another add", () => {
  const bridge = createCartConfirmationBridge();
  const added = confirmation();
  bridge.publish(added, "/");
  const seen: CartConfirmation[] = [];
  const unsubscribe = bridge.subscribe("/", (event) => seen.push(event));
  assert.deepEqual(seen, [added]);
  assert.equal(seen[0].result.cart[product.id], 1);
  unsubscribe();
  bridge.subscribe("/", (event) => seen.push(event));
  assert.deepEqual(seen, [added]);
});

test("without a subscriber only the last accepted confirmation is retained", () => {
  const bridge = createCartConfirmationBridge();
  bridge.publish(confirmation("/", 1), "/");
  bridge.publish(confirmation("/", 2), "/");
  const last = confirmation("/", 3);
  bridge.publish(last, "/");
  const seen: CartConfirmation[] = [];
  bridge.subscribe("/", (event) => seen.push(event));
  assert.deepEqual(seen, [last]);
});

test("partial stock adds preserve the actual cart result and focus trigger", () => {
  const bridge = createCartConfirmationBridge();
  const added = confirmation("/kategoria/synthetic", 7);
  added.trigger = {} as HTMLElement;
  let received: CartConfirmation | null = null;
  bridge.subscribe(added.pathname, (event) => {
    received = event;
    assert.equal(event.result, added.result);
    assert.equal(event.trigger, added.trigger);
    assert.equal(event.result.limit, "stock");
    assert.equal(event.result.delta, 3);
    assert.equal(event.result.quantity, 3);
  });
  bridge.publish(added, added.pathname);
  assert.equal(received, added);
});

test("rejected and fully capped adds neither notify nor replace an accepted pending add", () => {
  const bridge = createCartConfirmationBridge();
  const accepted = confirmation();
  const rejected = {
    ...accepted,
    result: addToCart({}, product.id, 1, { ...product, available: 0 }),
  };
  const capped = {
    ...accepted,
    result: addToCart({ [product.id]: 3 }, product.id, 1, product),
  };
  assert.equal(rejected.result.delta, 0);
  assert.equal(capped.result.delta, 0);
  bridge.publish(accepted, "/");
  bridge.publish(rejected, "/");
  bridge.publish(capped, "/");
  const seen: CartConfirmation[] = [];
  bridge.subscribe("/", (event) => seen.push(event));
  bridge.publish(rejected, "/");
  bridge.publish(capped, "/");
  assert.deepEqual(seen, [accepted]);
});

test("mounting on another route discards the pending confirmation permanently", () => {
  const bridge = createCartConfirmationBridge();
  bridge.publish(confirmation("/kategoria/synthetic"), "/kategoria/synthetic");
  const seen: CartConfirmation[] = [];
  const unsubscribe = bridge.subscribe("/zamowienie", (event) =>
    seen.push(event),
  );
  assert.equal(seen.length, 0);
  unsubscribe();
  bridge.subscribe("/kategoria/synthetic", (event) => seen.push(event));
  assert.equal(seen.length, 0);
});

test("late events from an old route do not notify or become a future pending add", () => {
  const bridge = createCartConfirmationBridge();
  const seen: CartConfirmation[] = [];
  const unsubscribe = bridge.subscribe("/zamowienie", (event) =>
    seen.push(event),
  );
  bridge.publish(confirmation("/kategoria/synthetic"), "/zamowienie");
  unsubscribe();
  bridge.subscribe("/kategoria/synthetic", (event) => seen.push(event));
  assert.equal(seen.length, 0);
});

test("the first add on the current new route waits for its subscriber even while the old subscriber remains", () => {
  const bridge = createCartConfirmationBridge();
  const old: CartConfirmation[] = [];
  const next: CartConfirmation[] = [];
  const stopOld = bridge.subscribe("/", (event) => old.push(event));
  const added = confirmation("/kategoria/synthetic");
  bridge.publish(added, "/kategoria/synthetic");
  assert.equal(old.length, 0);
  bridge.subscribe("/kategoria/synthetic", (event) => next.push(event));
  assert.deepEqual(next, [added]);
  stopOld();
  const another = confirmation("/kategoria/synthetic", 2);
  bridge.publish(another, "/kategoria/synthetic");
  assert.deepEqual(next, [added, another]);
});

test("a late old-route event cannot overwrite the current new route's pending confirmation", () => {
  const bridge = createCartConfirmationBridge();
  const old: CartConfirmation[] = [];
  bridge.subscribe("/", (event) => old.push(event));
  const added = confirmation("/kategoria/synthetic");
  bridge.publish(added, "/kategoria/synthetic");
  bridge.publish(confirmation("/", 2), "/kategoria/synthetic");
  assert.equal(old.length, 0);
  const next: CartConfirmation[] = [];
  bridge.subscribe("/kategoria/synthetic", (event) => next.push(event));
  assert.deepEqual(next, [added]);
});

test("without subscribers a late old-route event cannot create a stale pending confirmation", () => {
  const bridge = createCartConfirmationBridge();
  bridge.publish(confirmation("/"), "/kategoria/synthetic");
  const seen: CartConfirmation[] = [];
  bridge.subscribe("/", (event) => seen.push(event));
  assert.equal(seen.length, 0);
});

test("a delivered current add clears an older pending confirmation from an intermediate route", () => {
  const bridge = createCartConfirmationBridge();
  const current: CartConfirmation[] = [];
  const stopCurrent = bridge.subscribe("/", (event) => current.push(event));
  bridge.publish(confirmation("/kategoria/synthetic"), "/kategoria/synthetic");
  const latest = confirmation("/", 2);
  bridge.publish(latest, "/");
  assert.deepEqual(current, [latest]);
  stopCurrent();
  const next: CartConfirmation[] = [];
  bridge.subscribe("/kategoria/synthetic", (event) => next.push(event));
  assert.equal(next.length, 0);
});

test("cleanup from an older subscription cannot remove a newer subscription", () => {
  const bridge = createCartConfirmationBridge();
  const old: CartConfirmation[] = [];
  const next: CartConfirmation[] = [];
  const stopOld = bridge.subscribe("/", (event) => old.push(event));
  const stopNext = bridge.subscribe("/", (event) => next.push(event));
  stopOld();
  const added = confirmation();
  bridge.publish(added, "/");
  assert.equal(old.length, 0);
  assert.deepEqual(next, [added]);
  stopNext();
  const pending = confirmation("/", 2);
  bridge.publish(pending, "/");
  bridge.subscribe("/", (event) => next.push(event));
  assert.deepEqual(next, [added, pending]);
});

test("subscription identity survives replacement even when the listener is reused", () => {
  const bridge = createCartConfirmationBridge();
  const seen: CartConfirmation[] = [];
  const notify = (event: CartConfirmation) => seen.push(event);
  const stopOld = bridge.subscribe("/", notify);
  bridge.subscribe("/", notify);
  stopOld();
  const added = confirmation();
  bridge.publish(added, "/");
  assert.deepEqual(seen, [added]);
});
