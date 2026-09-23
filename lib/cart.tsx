"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
type Cart = Record<string, number>;
type CartContext = {
  cart: Cart;
  count: number;
  ready: boolean;
  add: (id: string, quantity?: number) => void;
  setQuantity: (id: string, quantity: number) => void;
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
  const add = (id: string, quantity = 1) =>
    setCart((c) =>
      valid({
        ...c,
        [id]: Math.min(999, (c[id] || 0) + Math.max(1, Math.floor(quantity))),
      }),
    );
  const setQuantity = (id: string, quantity: number) =>
    setCart((c) => {
      const next = { ...c };
      if (quantity <= 0) delete next[id];
      else next[id] = Math.min(999, Math.floor(quantity));
      return valid(next);
    });
  return (
    <Context.Provider
      value={{
        cart,
        count: Object.values(cart).reduce((a, b) => a + b, 0),
        ready,
        add,
        setQuantity,
        clear: () => setCart({}),
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
