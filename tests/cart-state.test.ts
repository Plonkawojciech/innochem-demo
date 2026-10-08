import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LINES,
  MAX_QUANTITY,
  addToCart,
  cartCount,
  cartLimitMessage,
  parseCart,
  setCartQuantity,
  type Cart,
  type CartProduct,
} from "../lib/cart-state";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = id(1);
const product = (available: number, over: Partial<CartProduct> = {}) => ({
  id: A,
  saleMode: "retail" as const,
  available,
  ...over,
});
const full = (): Cart =>
  Object.fromEntries(
    Array.from({ length: MAX_LINES }, (_, i) => [id(i + 100), 1]),
  );

test("persisted innochem-cart-v2 data stays compatible and is sanitised", () => {
  assert.deepEqual(parseCart({ [A]: 3 }), { [A]: 3 });
  assert.deepEqual(
    parseCart({
      [A]: 2,
      "not-a-uuid": 1,
      [id(2)]: 0,
      [id(3)]: 1.5,
      [id(4)]: 1000,
      [id(5)]: "2",
    }),
    { [A]: 2 },
  );
  for (const raw of [null, "x", 5, [], [[A, 1]]])
    assert.deepEqual(parseCart(raw), {});
  const tooMany = Object.fromEntries(
    Array.from({ length: MAX_LINES + 5 }, (_, i) => [id(i + 10), 1]),
  );
  assert.equal(Object.keys(parseCart(tooMany)).length, MAX_LINES);
});

test("adds accumulate against stock and report the actual delta", () => {
  const p = product(5);
  const first = addToCart({}, A, 3, p);
  assert.deepEqual([first.quantity, first.delta, first.limit], [3, 3, null]);
  const second = addToCart(first.cart, A, 3, p);
  assert.deepEqual(
    [second.before, second.quantity, second.delta, second.limit],
    [3, 5, 2, "stock"],
  );
  assert.match(cartLimitMessage(second)!, /Dodano tylko 2 szt\./);
  const third = addToCart(second.cart, A, 1, p);
  assert.deepEqual([third.quantity, third.delta, third.limit], [5, 0, "stock"]);
  assert.equal(third.cart, second.cart, "a no-op keeps the same cart object");
  assert.match(cartLimitMessage(third)!, /Dostępnych jest 5 szt\./);
});

test("rapid sequential clicks never exceed stock and deltas sum to the line", () => {
  const p = product(7);
  let cart: Cart = {};
  const deltas: number[] = [];
  for (let i = 0; i < 10; i++) {
    const r = addToCart(cart, A, 1, p);
    deltas.push(r.delta);
    cart = r.cart;
  }
  assert.deepEqual(deltas, [1, 1, 1, 1, 1, 1, 1, 0, 0, 0]);
  assert.equal(cart[A], 7);
  assert.equal(
    deltas.reduce((a, b) => a + b, 0),
    cart[A],
  );
});

test("quantity per line is capped at 999 even with larger stock", () => {
  const p = product(5000);
  const r = addToCart({ [A]: 998 }, A, 5, p);
  assert.deepEqual(
    [r.quantity, r.delta, r.limit],
    [MAX_QUANTITY, 1, "max_quantity"],
  );
  const unknown = addToCart({}, A, 5000);
  assert.deepEqual(
    [unknown.quantity, unknown.limit],
    [MAX_QUANTITY, "max_quantity"],
  );
  const again = addToCart(r.cart, A, 1, p);
  assert.deepEqual([again.delta, again.limit], [0, "max_quantity"]);
});

test("invalid products and quantities are rejected without touching the cart", () => {
  const cart: Cart = { [A]: 1 };
  const cases: [number, CartProduct | undefined, string][] = [
    [1, product(5, { saleMode: "inquiry" }), "not_retail"],
    [1, product(0), "out_of_stock"],
    [1, product(Number.NaN), "out_of_stock"],
    [1, product(-3), "out_of_stock"],
    [0, product(5), "invalid_quantity"],
    [-2, product(5), "invalid_quantity"],
    [0.5, product(5), "invalid_quantity"],
    [Number.NaN, product(5), "invalid_quantity"],
    [Number.POSITIVE_INFINITY, product(5), "invalid_quantity"],
    [1, product(5, { id: id(9) }), "invalid_product"],
  ];
  for (const [quantity, p, limit] of cases) {
    const r = addToCart(cart, A, quantity, p);
    assert.equal(r.limit, limit, `${quantity} ${JSON.stringify(p)}`);
    assert.equal(r.delta, 0);
    assert.equal(r.cart, cart);
    assert.ok(cartLimitMessage(r));
  }
  assert.equal(addToCart(cart, "bad-id", 1).limit, "invalid_product");
  assert.deepEqual(cart, { [A]: 1 }, "input is never mutated");
  // Fractions above one are floored, not rounded up.
  assert.equal(addToCart({}, A, 2.9, product(5)).quantity, 2);
});

test("the 50-line limit rejects new lines but not existing ones", () => {
  const cart = full();
  const extra = addToCart(cart, A, 1, product(5));
  assert.deepEqual([extra.delta, extra.limit], [0, "max_lines"]);
  assert.equal(Object.keys(extra.cart).length, MAX_LINES);
  assert.match(cartLimitMessage(extra)!, /50 różnych produktów/);
  const existing = id(100);
  const more = addToCart(cart, existing, 2, product(5, { id: existing }));
  assert.deepEqual([more.quantity, more.delta, more.limit], [3, 2, null]);
  const set = setCartQuantity(cart, A, 2, product(5));
  assert.equal(set.limit, "max_lines");
});

test("setQuantity lowers freely, removes at zero and clamps increases", () => {
  const p = product(3);
  const stale: Cart = { [A]: 8, [id(2)]: 1 };
  const lower = setCartQuantity(stale, A, 5, p);
  assert.deepEqual([lower.quantity, lower.delta, lower.limit], [5, -3, null]);
  const higher = setCartQuantity(lower.cart, A, 7, p);
  assert.deepEqual(
    [higher.quantity, higher.delta, higher.limit],
    [5, 0, "stock"],
  );
  const up = setCartQuantity({ [A]: 1 }, A, 10, p);
  assert.deepEqual([up.quantity, up.delta, up.limit], [3, 2, "stock"]);
  const removed = setCartQuantity(stale, A, 0, p);
  assert.deepEqual(removed.cart, { [id(2)]: 1 });
  assert.equal(removed.delta, -8);
  // A withdrawn product can still be reduced or removed, but not increased.
  const inquiry = product(5, { saleMode: "inquiry" });
  assert.equal(setCartQuantity(stale, A, 1, inquiry).quantity, 1);
  assert.equal(setCartQuantity({ [A]: 1 }, A, 2, inquiry).limit, "not_retail");
  assert.equal(setCartQuantity(stale, A, -1, p).limit, "invalid_quantity");
  assert.equal(setCartQuantity(stale, A, Number.NaN, p).cart, stale);
  assert.equal(setCartQuantity(stale, A, 2000).quantity, MAX_QUANTITY);
  assert.equal(cartCount(lower.cart), 6);
});
