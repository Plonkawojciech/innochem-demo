"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { item, track } from "./analytics";
import type { StoreProduct } from "./store-types";
type Cart = Record<string, number>;
type CartContext = {
  cart: Cart;
  count: number;
  ready: boolean;
  add: (id: string, quantity?: number, product?: StoreProduct) => void;
  setQuantity: (id: string, quantity: number, product?: StoreProduct) => void;
  clear: () => void;
};
const Context = createContext<CartContext | null>(null);
const KEY = "innochem-cart-v2";
function valid(value: unknown): Cart {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([id, q]) =>
          /^[a-f0-9-]{36}$/.test(id) &&
          typeof q === "number" &&
          Number.isInteger(q) &&
          q > 0 &&
          q <= 999,
      )
      .slice(0, 50),
  );
}
export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart>({});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      setCart(valid(JSON.parse(localStorage.getItem(KEY) || "{}")));
    } catch {}
    setReady(true);
    const sync = (e: StorageEvent) => {
      if (e.key === KEY) {
        try {
          setCart(valid(JSON.parse(e.newValue || "{}")));
        } catch {}
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(KEY, JSON.stringify(cart));
      } catch {}
    }
  }, [cart, ready]);
  const current = useRef(cart);
  current.current = cart;
  const change = (id: string, quantity: number, product?: StoreProduct) => {
    const before = current.current[id] || 0;
    const next = valid({ ...current.current, [id]: quantity });
    current.current = next;
    setCart(next);
    const delta = (next[id] || 0) - before;
    if (product && delta)
      track(delta > 0 ? "add_to_cart" : "remove_from_cart", {
        currency: "PLN",
        value: (product.priceCents * Math.abs(delta)) / 100,
        items: [item(product, Math.abs(delta))],
      });
  };
  const add = (id: string, quantity = 1, product?: StoreProduct) =>
    change(
      id,
      Math.min(
        999,
        (current.current[id] || 0) + Math.max(1, Math.floor(quantity)),
      ),
      product,
    );
  const setQuantity = (id: string, quantity: number, product?: StoreProduct) =>
    change(id, Math.min(999, Math.floor(quantity)), product);
  return (
    <Context.Provider
      value={{
        cart,
        count: Object.values(cart).reduce((a, b) => a + b, 0),
        ready,
        add,
        setQuantity,
        clear: () => {
          current.current = {};
          setCart({});
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useCart() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("Missing CartProvider");
  return ctx;
}
