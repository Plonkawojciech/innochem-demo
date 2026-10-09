"use client";
import { useAddToCart } from "@/components/AddToCartPopup";
import { useViewEvent } from "@/components/Analytics";
import { item } from "@/lib/analytics";
import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { money, type ProductCardData } from "@/lib/store-types";
import { useCart } from "@/lib/cart";
import { MAX_QUANTITY, cartLimitMessage } from "@/lib/cart-state";
function inCartNote(inCart: number, available: number) {
  if (inCart > available)
    return `W koszyku masz ${inCart} szt., a dostępnych jest ${available} szt. Zmniejsz ilość w koszyku.`;
  if (inCart >= Math.min(MAX_QUANTITY, available))
    return inCart >= MAX_QUANTITY
      ? `W koszyku masz już ${inCart} szt. To najwięcej dla jednej pozycji.`
      : `W koszyku masz już całą dostępną ilość: ${inCart} szt.`;
  return `W koszyku masz już ${inCart} szt.`;
}
export function BuyBox({
  product,
  shippingFromCents,
}: {
  product: ProductCardData;
  shippingFromCents: number | null;
}) {
  const { cart, ready } = useCart();
  const addToCart = useAddToCart();
  useViewEvent("view_item", {
    currency: "PLN",
    value: item(product).price,
    items: [item(product)],
  });
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [boxVisible, setBoxVisible] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) =>
      setBoxVisible(entry.isIntersecting),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
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
  const inStock = product.available > 0;
  const inCart = cart[product.id] || 0;
  // What can still be added; the cart clamps again and the server has the final word.
  const room = Math.max(0, Math.min(MAX_QUANTITY, product.available) - inCart);
  const limit = Math.max(1, room);
  const amount = Math.min(quantity, limit);
  const addToCartFrom = (e: MouseEvent<HTMLButtonElement>) => {
    const result = addToCart(product, amount, e.currentTarget);
    setNotice(cartLimitMessage(result));
    if (result.delta > 0) setQuantity(1);
  };
  const full = inStock && inCart > 0 && room === 0;
  return (
    <>
      <div className="buy-box" id="kupno" ref={box}>
        <div className="buy-top">
          <div className="buy-price">
            <span>{money(product.priceCents)}</span>
            <small>brutto z VAT, za sztukę</small>
            <small>
              {shippingFromCents === null
                ? "Koszt dostawy zobaczysz w koszyku"
                : `Dostawa kurierem od ${money(shippingFromCents)}`}
            </small>
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
              disabled={!ready || !inStock || full || amount <= 1}
              onClick={() => setQuantity(Math.max(1, amount - 1))}
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={limit}
              value={amount}
              disabled={!ready || !inStock || full}
              aria-label="Ilość"
              onChange={(e) =>
                setQuantity(
                  Math.max(
                    1,
                    Math.min(limit, Math.floor(Number(e.target.value)) || 1),
                  ),
                )
              }
            />
            <button
              type="button"
              aria-label="Zwiększ ilość"
              disabled={!ready || !inStock || full || amount >= limit}
              onClick={() => setQuantity(Math.min(limit, amount + 1))}
            >
              +
            </button>
          </div>
          {inStock ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!ready || full}
              onClick={addToCartFrom}
            >
              Dodaj do koszyka
            </button>
          ) : (
            <Link
              className="btn btn-outline"
              href={`/kontakt?produkt=${encodeURIComponent(product.name)}`}
            >
              Zapytaj o dostępność
            </Link>
          )}
        </div>
        <p role="status" className="added-note">
          {notice ? (
            <>
              {notice} <Link href="/zamowienie">Zobacz koszyk</Link>
            </>
          ) : inCart > 0 ? (
            <>
              {inCartNote(inCart, product.available)}{" "}
              <Link href="/zamowienie">Zobacz koszyk</Link>
            </>
          ) : null}
        </p>
        <p className="ship-note">
          Dokładny koszt dostawy zobaczysz w koszyku przed złożeniem zamówienia.{" "}
          <Link href="/dostawa-i-platnosci">Sposoby dostawy i płatności</Link>
        </p>
      </div>
      {inStock && (
        <div
          className="sticky-buy"
          data-hidden={boxVisible ? "true" : undefined}
          inert={boxVisible}
        >
          <div>
            <b>{money(product.priceCents)}</b>
            <small>
              {inCart > 0 ? `W koszyku: ${inCart} szt.` : "W magazynie"}
            </small>
          </div>
          {full ? (
            <Link className="btn btn-primary" href="/zamowienie">
              Zobacz koszyk
            </Link>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={addToCartFrom}
              disabled={!ready}
            >
              Do koszyka
            </button>
          )}
          {notice && <p className="sticky-note">{notice}</p>}
        </div>
      )}
    </>
  );
}
