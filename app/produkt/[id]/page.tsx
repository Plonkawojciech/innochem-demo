import Link from "next/link";
import { notFound } from "next/navigation";
import {
  product,
  productMedia,
  productDocuments,
  products,
} from "@/lib/server/catalog";
import { ProductGallery } from "@/components/ProductGallery";
import { ProductCard } from "@/components/ProductCard";
import { productFacts } from "@/lib/product-facts";
import { BuyBox } from "./BuyBox";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const p = await product((await params).id);
  return {
    title: p ? `${p.metaTitle || p.name} — INNOCHEM` : "Produkt — INNOCHEM",
    description: p?.metaDescription || p?.summary,
    alternates: { canonical: `/produkt/${p?.slug || (await params).id}` },
  };
}
export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const p = await product((await params).id);
  if (!p) notFound();
  const facts = productFacts(p.name);
  const primaryCategory = p.categorySlugs[0];
  const [media, documents, related] = await Promise.all([
    productMedia(p.id),
    productDocuments(p.id),
    primaryCategory
      ? products({ category: primaryCategory, page: 1 })
      : Promise.resolve(null),
  ]);
  const images = p.imagePath
    ? [
        { path: p.imagePath, alt: p.imageAlt || p.name },
        ...media.filter((m) => m.path !== p.imagePath),
      ]
    : media;
  const suggestions = (related?.items ?? [])
    .filter((x) => x.id !== p.id && x.saleMode === "retail")
    .slice(0, 4);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.summary,
    sku: p.sku,
    image: p.imagePath
      ? new URL(p.imagePath, process.env.APP_URL || "https://innochem.pl").href
      : undefined,
    brand: { "@type": "Brand", name: "Royal Purple" },
    offers:
      p.saleMode === "retail"
        ? {
            "@type": "Offer",
            url: new URL(
              `/produkt/${p.slug}`,
              process.env.APP_URL || "https://innochem.pl",
            ).href,
            priceCurrency: "PLN",
            price: (p.priceCents / 100).toFixed(2),
            availability:
              p.available > 0
                ? "https://schema.org/InStock"
                : "https://schema.org/OutOfStock",
            itemCondition: "https://schema.org/NewCondition",
          }
        : undefined,
  };
  return (
    <main className="wrap product-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <p className="crumbs">
        <Link href="/">Strona główna</Link> /{" "}
        <Link href="/katalog">Produkty</Link> / {facts.title}
      </p>
      <div className="pdp">
        <ProductGallery images={images} name={p.name} />
        <div className="pdp-copy">
          {facts.series && <p className="series-line">{facts.series}</p>}
          <h1 className="display">{facts.title}</h1>
          {(facts.grade || facts.volume) && (
            <p className="pdp-meta">
              {facts.grade && (
                <span>
                  Klasa lepkości <b>{facts.grade}</b>
                </span>
              )}
              {facts.volume && (
                <span>
                  Opakowanie <b>{facts.volume}</b>
                </span>
              )}
              {p.sku && (
                <span>
                  Kod <b>{p.sku}</b>
                </span>
              )}
            </p>
          )}
          {p.summary && <p className="desc">{p.summary}</p>}
          <BuyBox product={p} />
          <ul className="trust">
            <li>
              <b>Oryginał od dystrybutora</b>
              <span>Import z USA, sprzedaż w Polsce od 2009 roku.</span>
            </li>
            <li>
              <b>Wysyłka w 1–2 dni robocze</b>
              <span>
                Butelki pakujemy w karton z zabezpieczeniem przed wyciekiem.
              </span>
            </li>
            <li>
              <b>14 dni na zwrot</b>
              <span>
                Nieotwarte opakowanie zwrócisz bez podania przyczyny.{" "}
                <Link href="/zwroty-i-reklamacje">Zasady zwrotów</Link>
              </span>
            </li>
            <li>
              <b>Nie wiesz, który olej wybrać?</b>
              <span>
                Zadzwoń: <a href="tel:+48602155919">602 155 919</a> albo{" "}
                <Link href={`/kontakt?produkt=${encodeURIComponent(p.name)}`}>
                  zapytaj o ten produkt
                </Link>
                .
              </span>
            </li>
          </ul>
        </div>
      </div>
      <section className="product-description prose">
        <h2 className="display">Opis i zastosowanie</h2>
        <div dangerouslySetInnerHTML={{ __html: p.descriptionHtml }} />
      </section>
      {!!documents.length && (
        <section className="product-description prose">
          <h2 className="display">Dokumenty do pobrania</h2>
          <ul>
            {documents.map((d) => (
              <li key={d.path}>
                <a href={d.path} target="_blank" rel="noopener noreferrer">
                  {d.label}
                </a>
                {d.archival && " — dokument archiwalny ze wcześniejszej strony"}
              </li>
            ))}
          </ul>
          {documents.some((d) => d.archival) && (
            <p>
              Dokumenty archiwalne zachowujemy jako materiały źródłowe. Przed
              zastosowaniem oleju sprawdź zgodność specyfikacji z etykietą
              posiadanego opakowania. Aktualne dokumenty uzyskasz przez{" "}
              <Link href={`/kontakt?produkt=${encodeURIComponent(p.name)}`}>
                kontakt ze sklepem
              </Link>
              .
            </p>
          )}
        </section>
      )}
      {suggestions.length > 0 && (
        <section className="related">
          <div className="sec-head">
            <div>
              <h2 className="display">Z tej samej kategorii</h2>
            </div>
            {primaryCategory && (
              <Link href={`/kategoria/${primaryCategory}`}>
                Zobacz wszystkie
              </Link>
            )}
          </div>
          <div className="grid related-grid">
            {suggestions.map((x) => (
              <ProductCard key={x.id} p={x} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
