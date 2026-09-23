"use client";
import Link from "next/link";
import { useState } from "react";
import { money, type StoreProduct } from "@/lib/store-types";
import { useCart } from "@/lib/cart";
export function BuyBox({ product }: { product: StoreProduct }) {
  const { add } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  if (product.saleMode === "inquiry")
    return (
      <div className="buy-box">
        <p>Dobierzemy produkt i przygotujemy indywidualną ofertę.</p>
        <Link
          className="btn btn-primary"
          href={`/kontakt?produkt=${encodeURIComponent(product.name)}`}
        >
          Zadaj pytanie
        </Link>
      </div>
    );
  const limit = Math.max(1, Math.min(999, product.available));
  return (
    <div className="buy-box" id="kupno">
      <div className="buy-top">
        <div className="buy-price">
          <span>{money(product.priceCents)}</span>
          <small> brutto / szt.</small>
        </div>
        <span className={product.available ? "stock" : "unavailable"}>
          {product.available ? "W magazynie" : "Obecnie niedostępny"}
        </span>
      </div>
      <div className="buy-row">
        <div className="qty">
          <button
            type="button"
            aria-label="Zmniejsz ilość"
            disabled={quantity <= 1}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
          >
            −
          </button>
          <input
            type="number"
            min={1}
            max={limit}
            value={quantity}
            aria-label="Ilość"
            onChange={(e) =>
              setQuantity(
                Math.max(1, Math.min(limit, Number(e.target.value) || 1)),
              )
            }
          />
          <button
            type="button"
            aria-label="Zwiększ ilość"
            disabled={quantity >= limit}
            onClick={() => setQuantity((q) => Math.min(limit, q + 1))}
          >
            +
          </button>
        </div>
        <button
          className="btn btn-primary"
          disabled={!product.available}
          onClick={() => {
            add(product.id, quantity);
            setAdded(true);
          }}
        >
          {added ? "Dodano do koszyka" : "Dodaj do koszyka"}
        </button>
      </div>
      {added && (
        <p role="status">
          <Link href="/zamowienie">
            Produkt jest w koszyku. Przejdź do zamówienia
          </Link>
        </p>
      )}
      <p className="ship-note">
        <Link href="/dostawa-i-platnosci">Warunki dostawy</Link> ·{" "}
        <Link href="/zwroty-i-reklamacje">Zwroty i reklamacje</Link>
      </p>
    </div>
  );
}
