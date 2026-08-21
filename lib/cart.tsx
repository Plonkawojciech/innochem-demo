"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Cart = Record<string, number>;

type CartCtx = {
  cart: Cart;
  count: number;
  add: (id: string, qty?: number) => void;
  clear: () => void;
};

const Ctx = createContext<CartCtx | null>(null);
const KEY = "innochem-cart";

function load(): Cart {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart>({});

  useEffect(() => setCart(load()), []);

  const persist = (c: Cart) => {
    localStorage.setItem(KEY, JSON.stringify(c));
    setCart(c);
  };

  const add = (id: string, qty = 1) => persist({ ...cart, [id]: (cart[id] || 0) + qty });
  const clear = () => persist({});
  const count = Object.values(cart).reduce((a, b) => a + b, 0);

  return <Ctx.Provider value={{ cart, count, add, clear }}>{children}</Ctx.Provider>;
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart poza CartProvider");
  return ctx;
}
