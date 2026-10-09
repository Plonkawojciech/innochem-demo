"use client";
import { useEffect, useRef, useState } from "react";
import type { ProductCardData } from "@/lib/store-types";
import { ProductCard } from "./ProductCard";
/** Horizontal, scroll-snapped row of product cards with previous/next arrows. */
export function ProductCarousel({ products }: { products: ProductCardData[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const update = () => {
    const el = track.current;
    if (!el) return;
    setEdge({
      start: el.scrollLeft <= 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    });
  };
  useEffect(() => {
    update();
    const el = track.current;
    if (!el) return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [products.length]);
  const scroll = (direction: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>(".card");
    const width = card ? card.offsetWidth + 20 : el.clientWidth * 0.8;
    el.scrollBy({ left: direction * width * 2, behavior: "smooth" });
  };
  return (
    <div className="carousel">
      <div className="carousel-track" ref={track} onScroll={update}>
        {products.map((p) => (
          <ProductCard
            key={p.id}
            p={p}
            imageSizes="(max-width: 700px) calc((100vw - 40px) * 0.72 - 26px), (max-width: 1100px) calc((100vw - 220px) / 3), 233px"
          />
        ))}
      </div>
      {products.length > 1 && (
        <div className="carousel-nav">
          <button
            type="button"
            aria-label="Poprzednie produkty"
            disabled={edge.start}
            onClick={() => scroll(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Następne produkty"
            disabled={edge.end}
            onClick={() => scroll(1)}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
