"use client";
import Link from "next/link";
import { item, track } from "@/lib/analytics";
import { useViewEvent } from "./Analytics";
import { useState } from "react";
import { money, type StoreProduct } from "@/lib/store-types";
import { cartLimitMessage } from "@/lib/cart-state";
import { useAddToCart } from "./AddToCartPopup";
import { mediaSrc, mediaSrcSet } from "@/lib/media";
import { productFacts } from "@/lib/product-facts";
export function ProductCard({
  p,
  priority = false,
  listId,
  imageSizes = "(max-width: 700px) calc((100vw - 104px) / 2), (max-width: 1100px) calc((100vw - 220px) / 3), 233px",
}: {
  p: StoreProduct;
  priority?: boolean;
  listId?: string;
  imageSizes?: string;
}) {
  const addToCart = useAddToCart();
  const [notice, setNotice] = useState<string | null>(null);
  const facts = productFacts(p.name);
  const inStock = p.saleMode === "retail" && p.available > 0;
  return (
    <article
      className="card"
      onClick={(e) => {
        if (
          listId &&
          (e.target as Element).closest(`a[href="/produkt/${p.slug}"]`)
        )
          track("select_item", { item_list_id: listId, items: [item(p)] });
      }}
    >
      <Link className="ph" href={`/produkt/${p.slug}`}>
        {p.imagePath ? (
          <img
            src={mediaSrc(p.imagePath, 480)}
            srcSet={mediaSrcSet(p.imagePath, [320, 480, 640])}
            sizes={imageSizes}
            alt={p.imageAlt || p.name}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
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
            type="button"
            className="add"
            disabled={!inStock}
            onClick={(e) => {
              const result = addToCart(p, 1, e.currentTarget);
              setNotice(result.delta > 0 ? null : cartLimitMessage(result));
            }}
          >
            {inStock ? "Do koszyka" : "Brak w magazynie"}
          </button>
        ) : (
          <Link
            className="add ghost"
            href={`/kontakt?produkt=${encodeURIComponent(p.name)}`}
          >
            Zapytaj o produkt
          </Link>
        )}
        <p className="card-cart-note" role="status">
          {notice && (
            <>
              {notice} <Link href="/zamowienie">Zobacz koszyk</Link>
            </>
          )}
        </p>
      </div>
    </article>
  );
}
export function ProductGrid({
  products,
  listId,
}: {
  products: StoreProduct[];
  listId?: string;
}) {
  useViewEvent(
    "view_item_list",
    { item_list_id: listId, items: products.map((p) => item(p)) },
    !!listId && products.length > 0,
  );
  return (
    <div className="grid" id="prodGrid">
      {products.map((p, i) => (
        <ProductCard key={p.id} p={p} priority={i < 2} listId={listId} />
      ))}
    </div>
  );
}
