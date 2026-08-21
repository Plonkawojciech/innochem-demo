"use client";

import Link from "next/link";
import { PRODUCTS, zl, Product } from "@/lib/products";
import { useCart } from "@/lib/cart";

export function ProductCard({ p }: { p: Product }) {
  const { add } = useCart();
  return (
    <article className="card">
      <Link className="ph" href={`/produkt/${p.id}`}>
        <img src={p.img} alt={`${p.name} ${p.visc}`} loading="lazy" />
      </Link>
      <div className="body">
        <div className="visc">
          {p.visc}
          <small>{p.tag}</small>
        </div>
        <Link className="name" href={`/produkt/${p.id}`}>
          {p.name} · {p.vol}
        </Link>
        <div className="price-row">
          <div className="price">
            {zl(p.price)}
            <small>brutto / szt.</small>
          </div>
          <button className="add" onClick={() => add(p.id)}>
            Do koszyka
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProductGrid() {
  return (
    <div className="grid rv in" id="prodGrid">
      {PRODUCTS.map((p) => (
        <ProductCard key={p.id} p={p} />
      ))}
    </div>
  );
}
