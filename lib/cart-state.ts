/** Pure cart rules shared by the client cart and its tests. The server re-validates every order. */
import type { StoreProduct } from "./store-types";
export type Cart = Record<string, number>;
export const CART_KEY = "innochem-cart-v2";
export const MAX_QUANTITY = 999;
export const MAX_LINES = 50;
export type CartProduct = Pick<StoreProduct, "id" | "saleMode" | "available">;
/** Why a change was rejected or reduced; null when the request applied in full. */
export type CartLimit =
  | "invalid_product"
  | "invalid_quantity"
  | "not_retail"
  | "out_of_stock"
  | "stock"
  | "max_quantity"
  | "max_lines";
export type CartResult = {
  cart: Cart;
  /** Quantity of this line before and after the change. */
  before: number;
  quantity: number;
  /** Actual change applied; analytics and the popup use this, never the request. */
  delta: number;
  /** Requested increment (add) or target quantity (set). */
  requested: number;
  limit: CartLimit | null;
  /** Stock used for the decision, when the product was known. */
  available: number | null;
};
const ID = /^[a-f0-9-]{36}$/;
export function parseCart(value: unknown): Cart {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([id, q]) =>
          ID.test(id) &&
          typeof q === "number" &&
          Number.isInteger(q) &&
          q > 0 &&
          q <= MAX_QUANTITY,
      )
      .slice(0, MAX_LINES),
  );
}
export function cartCount(cart: Cart) {
  return Object.values(cart).reduce((a, b) => a + b, 0);
}
function stockOf(product?: CartProduct) {
  if (!product) return null;
  const n = Number(product.available);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
function write(cart: Cart, id: string, quantity: number): Cart {
  const next = { ...cart };
  if (quantity > 0) next[id] = quantity;
  else delete next[id];
  return next;
}
function change(
  cart: Cart,
  id: string,
  requested: number,
  product: CartProduct | undefined,
  target: (before: number) => number | CartLimit,
): CartResult {
  const before = ID.test(id) ? cart[id] || 0 : 0;
  const available = stockOf(product);
  const done = (next: Cart, limit: CartLimit | null): CartResult => ({
    cart: next,
    before,
    quantity: next[id] || 0,
    delta: (next[id] || 0) - before,
    requested,
    limit,
    available,
  });
  if (!ID.test(id) || (product && product.id !== id))
    return done(cart, "invalid_product");
  const wanted = target(before);
  if (typeof wanted === "string") return done(cart, wanted);
  // Lowering a line is always allowed, also below stale stock or for withdrawn products.
  if (wanted <= before) return done(write(cart, id, wanted), null);
  if (product && product.saleMode !== "retail") return done(cart, "not_retail");
  if (available === 0) return done(cart, "out_of_stock");
  if (!before && Object.keys(cart).length >= MAX_LINES)
    return done(cart, "max_lines");
  const cap = Math.min(MAX_QUANTITY, available ?? MAX_QUANTITY);
  const next = Math.max(before, Math.min(cap, wanted));
  const limit =
    next >= wanted
      ? null
      : available !== null && available <= MAX_QUANTITY
        ? "stock"
        : "max_quantity";
  return done(next === before ? cart : write(cart, id, next), limit);
}
/** Adds an increment, clamped to stock and MAX_QUANTITY. Never lowers an existing line. */
export function addToCart(
  cart: Cart,
  id: string,
  quantity: number,
  product?: CartProduct,
): CartResult {
  return change(cart, id, quantity, product, (before) =>
    Number.isFinite(quantity) && Math.floor(quantity) >= 1
      ? before + Math.floor(quantity)
      : "invalid_quantity",
  );
}
/** Sets a line to an exact quantity; 0 removes it. Increases are clamped like add. */
export function setCartQuantity(
  cart: Cart,
  id: string,
  quantity: number,
  product?: CartProduct,
): CartResult {
  return change(cart, id, quantity, product, () =>
    Number.isFinite(quantity) && quantity >= 0
      ? Math.floor(quantity)
      : "invalid_quantity",
  );
}
/** Customer-facing explanation of a rejected or partial change, or null. */
export function cartLimitMessage(r: CartResult): string | null {
  switch (r.limit) {
    case null:
      return null;
    case "invalid_product":
      return "Nie udało się rozpoznać produktu. Odśwież stronę i spróbuj ponownie.";
    case "invalid_quantity":
      return "Podaj ilość jako liczbę całkowitą, co najmniej 1.";
    case "not_retail":
      return "Ten produkt sprzedajemy na zapytanie, nie przez koszyk.";
    case "out_of_stock":
      return "Ten produkt jest obecnie niedostępny.";
    case "max_lines":
      return `Koszyk może zawierać najwyżej ${MAX_LINES} różnych produktów. Złóż zamówienie albo usuń coś z koszyka.`;
    case "stock":
      return r.delta > 0
        ? `Dodano tylko ${r.delta} szt. W koszyku masz już całą dostępną ilość: ${r.quantity} szt.`
        : `Dostępnych jest ${r.available} szt., a w koszyku masz już ${r.quantity} szt.`;
    case "max_quantity":
      return r.delta > 0
        ? `Dodano tylko ${r.delta} szt. Jedna pozycja może mieć najwyżej ${MAX_QUANTITY} szt.`
        : `W koszyku masz już ${r.quantity} szt. To najwięcej dla jednej pozycji.`;
  }
}
