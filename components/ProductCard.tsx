"use client";
import Link from "next/link";
import { useState } from "react";
import { money, type StoreProduct } from "@/lib/store-types";
import { useCart } from "@/lib/cart";
import { mediaSrc, mediaSrcSet } from "@/lib/media";
import { productFacts } from "@/lib/product-facts";
export function ProductCard({
  p,
  priority = false,
}: {
  p: StoreProduct;
  priority?: boolean;
}) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);
  const facts = productFacts(p.name);
  const inStock = p.saleMode === "retail" && p.available > 0;
  return (
    <article className="card">
      <Link className="ph" href={`/produkt/${p.slug}`}>
        {p.imagePath ? (
          <img
            src={mediaSrc(p.imagePath, 480)}
            srcSet={mediaSrcSet(p.imagePath, [320, 480, 640])}
            sizes="(max-width: 700px) 46vw, (max-width: 1000px) 30vw, 300px"
            alt={p.imageAlt || p.name}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            width={480}
            height={480}
          />
        ) : (
          <span className="no-photo">{p.name}</span>
        )}
        {facts.grade && <span className="grade">{facts.grade}</span>}
      </Link>
      <div className="body">
        {facts.series && <span className="series">{facts.series}</span>}
        <Link className="name" href={`/produkt/${p.slug}`}>
          {facts.title}
        </Link>
        {facts.volume && <span className="volume">{facts.volume}</span>}
        <div className="price-row">
          {p.saleMode === "retail" ? (
            <div className="price">
              {money(p.priceCents)}
              <small>brutto z VAT</small>
            </div>
          ) : (
            <div className="price inquiry">Wycena indywidualna</div>
          )}
          <span className={`stock-dot ${inStock ? "in" : "out"}`}>
            {p.saleMode === "inquiry"
              ? "Na zapytanie"
              : inStock
                ? "W magazynie"
                : "Niedostępny"}
          </span>
        </div>
        {p.saleMode === "retail" ? (
          <button
            className="add"
            disabled={!inStock}
            onClick={() => {
              add(p.id);
              setAdded(true);
            }}
          >
            {added
              ? "Dodano do koszyka"
              : inStock
                ? "Do koszyka"
                : "Brak w magazynie"}
          </button>
        ) : (
          <Link
            className="add ghost"
            href={`/kontakt?produkt=${encodeURIComponent(p.name)}`}
          >
            Zapytaj o produkt
          </Link>
        )}
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
      {products.map((p, i) => (
        <ProductCard key={p.id} p={p} priority={i < 3} />
      ))}
    </div>
  );
}
