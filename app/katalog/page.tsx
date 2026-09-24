import { notFound } from "next/navigation";
import { CatalogPagination } from "@/components/CatalogPagination";
import { CatalogFilters } from "@/components/CatalogFilters";
import Link from "next/link";
import {
  products,
  categories,
  catalogPage,
  catalogGrades,
} from "@/lib/server/catalog";
import { ProductGrid } from "@/components/ProductCard";
export const dynamic = "force-dynamic";
type Search = { q?: string; page?: string; g?: string };
function readGrade(value: unknown) {
  return typeof value === "string" && /^\d{1,2}W-\d{2,3}$/.test(value)
    ? value
    : null;
}
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const page = catalogPage(params.page);
  const search = typeof params.q === "string" ? params.q.slice(0, 120) : "";
  const grade = readGrade(params.g);
  const query = new URLSearchParams();
  if (search) query.set("q", search);
  if (grade) query.set("g", grade);
  if (page > 1) query.set("page", String(page));
  return {
    title: `Oleje Royal Purple${grade ? ` ${grade}` : ""} — katalog INNOCHEM${page > 1 ? ` — strona ${page}` : ""}`,
    description:
      "Wszystkie oleje silnikowe, motocyklowe i wyścigowe Royal Purple dostępne w Polsce. Ceny brutto, stany magazynowe na żywo, wysyłka z Kielc.",
    alternates: { canonical: `/katalog${query.size ? `?${query}` : ""}` },
    ...(search || grade ? { robots: { index: false, follow: true } } : {}),
  };
}
export default async function Catalog({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 120) : "";
  const grade = readGrade(params.g);
  const page = catalogPage(params.page);
  const [catalog, cats, grades] = await Promise.all([
    products({ search: q, grade: grade || undefined, page }),
    categories(),
    catalogGrades(),
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
          Oryginalne produkty z importu, sprzedawane w Polsce od 2009 roku.
          Wybierz kategorię lub klasę lepkości zalecaną przez producenta
          pojazdu.
        </p>
      </div>
      <CatalogFilters
        base="/katalog"
        categories={cats}
        activeCategory={null}
        grades={grades}
        grade={grade}
        q={q}
        total={total}
      />
      {items.length ? (
        <ProductGrid products={items} />
      ) : (
        <div className="empty-state">
          <h2>Nie znaleźliśmy takiego produktu</h2>
          <p>
            Spróbuj krótszej nazwy albo samej lepkości, na przykład „5W30”.
            Możesz też napisać do nas, dobierzemy olej do silnika.
          </p>
          <Link href="/katalog">Pokaż cały katalog</Link>
        </div>
      )}
      <CatalogPagination
        page={page}
        pages={catalog.pages}
        grade={grade}
        path="/katalog"
        search={q}
      />
      <section className="catalog-trust">
        <div>
          <b>Wyłączny dystrybutor</b>
          <span>Oryginalne produkty Royal Purple z USA, od 2009 roku.</span>
        </div>
        <div>
          <b>Wysyłka w 1–2 dni robocze</b>
          <span>
            Zamówienia opłacone do południa pakujemy tego samego dnia.
          </span>
        </div>
        <div>
          <b>14 dni na zwrot</b>
          <span>Nieotwarte produkty zwrócisz bez podawania przyczyny.</span>
        </div>
        <div>
          <b>Pomoc w doborze</b>
          <span>
            Zadzwoń: <a href="tel:+48602155919">602 155 919</a>, dni robocze
            8:00–16:00.
          </span>
        </div>
      </section>
    </main>
  );
}
