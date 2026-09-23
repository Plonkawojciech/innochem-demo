"use client";
import Link from "next/link";
import { useState } from "react";
import { money, type StoreProduct } from "@/lib/store-types";
import { useCart } from "@/lib/cart";
export function ProductCard({ p }: { p: StoreProduct }) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);
  return (
    <article className="card">
      <Link className="ph" href={`/produkt/${p.slug}`}>
        {p.imagePath ? (
          <img src={p.imagePath} alt={p.imageAlt || p.name} loading="lazy" />
        ) : (
          <span className="no-photo">{p.name}</span>
        )}
      </Link>
      <div className="body">
        <Link className="name" href={`/produkt/${p.slug}`}>
          {p.name}
        </Link>
        <p className="availability">
          {p.saleMode === "inquiry"
            ? "Dobór indywidualny"
            : p.available > 0
              ? "Dostępny"
              : "Obecnie niedostępny"}
        </p>
        <div className="price-row">
          {p.saleMode === "retail" ? (
            <>
              <div className="price">
                {money(p.priceCents)}
                <small>brutto / szt.</small>
              </div>
              <button
                className="add"
                disabled={!p.available}
                onClick={() => {
                  add(p.id);
                  setAdded(true);
                }}
              >
                {added ? "Dodano" : "Do koszyka"}
              </button>
            </>
          ) : (
            <Link
              className="btn btn-primary"
              href={`/kontakt?produkt=${encodeURIComponent(p.name)}`}
            >
              Zadaj pytanie
            </Link>
          )}
        </div>
        {added && (
          <Link className="cart-shortcut" href="/zamowienie">
            Przejdź do koszyka
          </Link>
        )}
      </div>
    </article>
  );
}
export function ProductGrid({ products }: { products: StoreProduct[] }) {
  return (
    <div className="grid" id="prodGrid">
      {products.map((p) => (
        <ProductCard key={p.id} p={p} />
      ))}
    </div>
  );
}
