"use client";
import { useEffect } from "react";
import { useCart } from "@/lib/cart";
export function ClearPurchasedCart({ id }: { id: string }) {
  const { clear, ready } = useCart();
  useEffect(() => {
    if (ready && sessionStorage.getItem("innochem-last-order") === id) {
      sessionStorage.removeItem("innochem-last-order");
      clear();
    }
  }, [id, ready, clear]);
  return null;
}
