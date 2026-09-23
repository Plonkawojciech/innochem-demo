import { notFound } from "next/navigation";
import { CatalogPagination } from "@/components/CatalogPagination";
import Link from "next/link";
import { products, categories, catalogPage } from "@/lib/server/catalog";
import { ProductGrid } from "@/components/ProductCard";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = catalogPage(params.page);
  const search = typeof params.q === "string" ? params.q.slice(0, 120) : "";
  const query = new URLSearchParams();
  if (search) query.set("q", search);
  if (page > 1) query.set("page", String(page));
  return {
    title: `Oleje Royal Purple — katalog INNOCHEM${page > 1 ? ` — strona ${page}` : ""}`,
    alternates: { canonical: `/katalog${query.size ? `?${query}` : ""}` },
    ...(search ? { robots: { index: false, follow: true } } : {}),
  };
}
export default async function Catalog({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 120) : "";
  const page = catalogPage(params.page);
  const [catalog, cats] = await Promise.all([
    products({ search: q, page }),
    categories(),
  ]);
  if (page > catalog.pages) notFound();
  const { items, total } = catalog;
  return (
    <main className="wrap catalog-page">
      <p className="crumbs">
        <Link href="/">Strona główna</Link> / Produkty
      </p>
      <div className="catalog-heading">
        <h1 className="display">Oleje Royal Purple</h1>
        <p>
          Wybierz produkt do swojego samochodu, motocykla lub zastosowania
          sportowego.
        </p>
      </div>
      <form className="search-form" role="search">
        <label htmlFor="product-search">Szukaj produktu</label>
        <div>
          <input
            id="product-search"
            name="q"
            defaultValue={q}
            placeholder="Nazwa lub lepkość, np. 5W30"
            maxLength={120}
          />
          <button className="btn btn-primary">Szukaj</button>
        </div>
      </form>
      <div className="category-links">
        {cats
          .filter((c) =>
            [
              "oleje-samochodowe",
              "oleje-motocyklowe",
              "oleje-wyscigowe",
            ].includes(c.slug),
          )
          .map((c) => (
            <Link key={c.id} href={`/kategoria/${c.slug}`}>
              {c.name}
            </Link>
          ))}
      </div>
      <p className="result-count">
        {total} produktów{q && ` dla „${q}”`}
      </p>
      {items.length ? (
        <ProductGrid products={items} />
      ) : (
        <div className="empty-state">
          <h2>Nie znaleźliśmy takiego produktu</h2>
          <p>
            Spróbuj krótszej nazwy lub skontaktuj się z nami, aby dobrać olej.
          </p>
          <Link href="/katalog">Pokaż cały katalog</Link>
        </div>
      )}
      <CatalogPagination
        page={page}
        pages={catalog.pages}
        path="/katalog"
        search={q}
      />
    </main>
  );
}
