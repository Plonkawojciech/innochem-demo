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
        <p>
          Ten produkt sprzedajemy na zapytanie. Opisz zastosowanie i ilość, a
          przygotujemy wycenę z transportem.
        </p>
        <Link
          className="btn btn-primary"
          href={`/kontakt?produkt=${encodeURIComponent(product.name)}`}
        >
          Zapytaj o wycenę
        </Link>
      </div>
    );
  const limit = Math.max(1, Math.min(999, product.available));
  const inStock = product.available > 0;
  const addToCart = () => {
    add(product.id, quantity);
    setAdded(true);
  };
  return (
    <>
      <div className="buy-box" id="kupno">
        <div className="buy-top">
          <div className="buy-price">
            <span>{money(product.priceCents)}</span>
            <small>brutto z VAT, za sztukę</small>
          </div>
          <span className={inStock ? "stock" : "unavailable"}>
            {inStock
              ? product.available <= 5
                ? `Ostatnie ${product.available} szt.`
                : "W magazynie, wysyłka w 1–2 dni robocze"
              : "Obecnie niedostępny"}
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
            disabled={!inStock}
            onClick={addToCart}
          >
            {added
              ? "Dodano do koszyka"
              : inStock
                ? "Dodaj do koszyka"
                : "Zapytaj o dostępność"}
          </button>
        </div>
        {added && (
          <p role="status" className="added-note">
            Produkt jest w koszyku.{" "}
            <Link href="/zamowienie">Przejdź do zamówienia</Link>
          </p>
        )}
        <p className="ship-note">
          Koszt dostawy zobaczysz w koszyku przed złożeniem zamówienia.{" "}
          <Link href="/dostawa-i-platnosci">Sposoby dostawy i płatności</Link>
        </p>
      </div>
      <div className="sticky-buy" aria-hidden={!inStock}>
        <div>
          <b>{money(product.priceCents)}</b>
          <small>{inStock ? "W magazynie" : "Niedostępny"}</small>
        </div>
        <button
          className="btn btn-primary"
          disabled={!inStock}
          onClick={addToCart}
        >
          {added ? "W koszyku" : "Do koszyka"}
        </button>
      </div>
    </>
  );
}
