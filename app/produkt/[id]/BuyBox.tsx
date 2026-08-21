"use client";

import { useState } from "react";
import { Product, zl } from "@/lib/products";
import { useCart } from "@/lib/cart";

export function BuyBox({ product }: { product: Product }) {
  const { add } = useCart();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const change = (d: number) => setQty((q) => Math.max(1, q + d));
  const buy = () => {
    add(product.id, qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 1400);
  };

  return (
    <div className="buy-box">
      <div className="buy-top">
        <div className="buy-price">
          <span>{zl(product.price)}</span> <small>brutto / szt.</small>
        </div>
        <span className="stock">W magazynie — wysyłka w 24 h</span>
      </div>
      <div className="buy-row">
        <div className="qty">
          <button type="button" aria-label="Zmniejsz ilość" onClick={() => change(-1)}>
            −
          </button>
          <input
            value={qty}
            inputMode="numeric"
            aria-label="Ilość"
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
          />
          <button type="button" aria-label="Zwiększ ilość" onClick={() => change(1)}>
            +
          </button>
        </div>
        <button className="btn btn-primary" onClick={buy}>
          {added ? "Dodano do koszyka" : "Dodaj do koszyka"}
        </button>
      </div>
      <p className="ship-note">Darmowa dostawa od 250 zł · Kurier 24 h lub paczkomat · Zwrot do 30 dni</p>
    </div>
  );
}
