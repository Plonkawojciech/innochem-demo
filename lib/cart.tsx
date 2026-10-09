"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { item, track } from "./analytics";
import {
  CART_KEY,
  addToCart,
  cartCount,
  parseCart,
  setCartQuantity,
  type Cart,
  type CartResult,
} from "./cart-state";
import type { StoreProduct } from "./store-types";
export type { CartResult } from "./cart-state";
type CartContext = {
  cart: Cart;
  count: number;
  ready: boolean;
  /** Returns what actually changed; `delta` 0 means nothing was added. */
  add: (id: string, quantity?: number, product?: StoreProduct) => CartResult;
  setQuantity: (
    id: string,
    quantity: number,
    product?: StoreProduct,
  ) => CartResult;
  clear: () => void;
};
const Context = createContext<CartContext | null>(null);
type CartActions = Pick<CartContext, "add" | "setQuantity" | "clear">;
const ActionsContext = createContext<CartActions | null>(null);
function read(raw: string | null): Cart {
  try {
    return parseCart(JSON.parse(raw || "{}"));
  } catch {
    return {};
  }
}
export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart>({});
  const [ready, setReady] = useState(false);
  // The ref is the source of truth between renders, so rapid clicks accumulate.
  const current = useRef(cart);
  const commit = useCallback((next: Cart) => {
    current.current = next;
    setCart(next);
  }, []);
  useEffect(() => {
    try {
      commit(read(localStorage.getItem(CART_KEY)));
    } catch {
      // Storage blocked: the cart still works in memory for this page view.
    }
    setReady(true);
    const sync = (e: StorageEvent) => {
      try {
        if (
          e.storageArea === localStorage &&
          (e.key === CART_KEY || e.key === null)
        )
          commit(read(e.newValue));
      } catch {}
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
      } catch {}
    }
  }, [cart, ready]);
  const apply = useCallback(
    (r: CartResult, product?: StoreProduct) => {
      if (r.cart !== current.current) commit(r.cart);
      if (product && r.delta)
        track(r.delta > 0 ? "add_to_cart" : "remove_from_cart", {
          currency: "PLN",
          value: item(product, Math.abs(r.delta)).price * Math.abs(r.delta),
          items: [item(product, Math.abs(r.delta))],
        });
      return r;
    },
    [commit],
  );
  const add = useCallback<CartActions["add"]>(
    (id, quantity = 1, product) =>
      apply(addToCart(current.current, id, quantity, product), product),
    [apply],
  );
  const setQuantity = useCallback<CartActions["setQuantity"]>(
    (id, quantity, product) =>
      apply(setCartQuantity(current.current, id, quantity, product), product),
    [apply],
  );
  const clear = useCallback(() => commit({}), [commit]);
  const actions = useMemo(
    () => ({ add, setQuantity, clear }),
    [add, setQuantity, clear],
  );
  return (
    <ActionsContext.Provider value={actions}>
      <Context.Provider
        value={{
          cart,
          count: cartCount(cart),
          ready,
          ...actions,
        }}
      >
        {children}
      </Context.Provider>
    </ActionsContext.Provider>
  );
}
export function useCart() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("Missing CartProvider");
  return ctx;
}
/** Cards need stable cart actions, not subscriptions to every quantity change. */
export function useCartActions() {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("Missing CartProvider");
  return actions;
}
