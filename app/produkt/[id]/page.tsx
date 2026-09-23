import Link from "next/link";
import { notFound } from "next/navigation";
import { product, productMedia, productDocuments } from "@/lib/server/catalog";
import { ProductGallery } from "@/components/ProductGallery";
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
  const [media, documents] = await Promise.all([
    productMedia(p.id),
    productDocuments(p.id),
  ]);
  const images = p.imagePath
    ? [
        { path: p.imagePath, alt: p.imageAlt || p.name },
        ...media.filter((m) => m.path !== p.imagePath),
      ]
    : media;
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
    <main className="wrap">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <p className="crumbs">
        <Link href="/">Strona główna</Link> /{" "}
        <Link href="/katalog">Produkty</Link> / {p.name}
      </p>
      <div className="pdp">
        <ProductGallery images={images} name={p.name} />
        <div>
          <p className="label">Royal Purple</p>
          <h1 className="display">{p.name}</h1>
          <p className="desc">{p.summary}</p>
          <BuyBox product={p} />
          <p className="product-help">
            Potrzebujesz pomocy w doborze?{" "}
            <Link href={`/kontakt?produkt=${encodeURIComponent(p.name)}`}>
              Zapytaj o ten produkt
            </Link>
            .
          </p>
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
    </main>
  );
}
