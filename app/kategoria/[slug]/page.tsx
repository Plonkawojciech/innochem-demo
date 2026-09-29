import { Breadcrumbs } from "@/components/Breadcrumbs";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  products,
  categories,
  catalogPage,
  catalogGrades,
} from "@/lib/server/catalog";
import { CatalogPagination } from "@/components/CatalogPagination";
import { CatalogToolbar } from "@/components/CatalogFilters";
import { ProductGrid } from "@/components/ProductCard";
export const dynamic = "force-dynamic";
type Search = { q?: string; page?: string; g?: string };
function readGrade(value: unknown) {
  return typeof value === "string" && /^\d{1,2}W-\d{2,3}$/.test(value)
    ? value
    : null;
}
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Search>;
}) {
  const { slug } = await params;
  const search = await searchParams;
  const page = catalogPage(search.page);
  const grade = readGrade(search.g);

  const c = (await categories()).find((c) => c.slug === slug);
  return {
    title: `${c?.name || "Kategoria"}${grade ? ` ${grade}` : ""} — INNOCHEM${page > 1 ? ` — strona ${page}` : ""}`,
    alternates: {
      canonical: `/kategoria/${slug}${page > 1 ? `?page=${page}` : ""}`,
    },
    ...(search.q !== undefined || search.g !== undefined
      ? { robots: { index: false, follow: true } }
      : {}),
  };
}
export default async function Category({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Search>;
}) {
  const { slug } = await params;
  const all = await categories();
  const c = all.find((c) => c.slug === slug);
  if (!c) notFound();
  if (
    [
      "oleje-przemyslowe",
      "oleje-i-smary-przekladniowe",
      "smary-do-kompresorow",
      "oleje-do-sprezarek",
      "oleje-hydrauliczne",
      "inne-plyny-i-oleje",
    ].includes(slug)
  )
    redirect("/przemysl");
  const search = await searchParams;
  const page = catalogPage(search.page);
  const grade = readGrade(search.g);
  const q = typeof search.q === "string" ? search.q.slice(0, 120) : "";
  const [catalog, grades] = await Promise.all([
    products({ category: slug, search: q, grade: grade || undefined, page }),
    catalogGrades(slug),
  ]);
  if (page > catalog.pages) notFound();
  const { items, total } = catalog;
  const parentSlug = all.find((x) => x.id === c.parentId)?.slug ?? null;
  return (
    <main className="wrap catalog-page">
      <Breadcrumbs
        items={[
          { name: "Strona główna", path: "/" },
          { name: "Produkty", path: "/katalog" },
          { name: c.name, path: `/kategoria/${slug}` },
        ]}
      />
      <CatalogToolbar
        title={c.name}
        base={`/kategoria/${slug}`}
        categories={all}
        activeCategory={parentSlug || slug}
        grades={grades}
        grade={grade}
        q={q}
        total={total}
      />
      {c.descriptionHtml && (
        <details className="catalog-intro">
          <summary>O kategorii</summary>
          <div
            className="prose"
            dangerouslySetInnerHTML={{ __html: c.descriptionHtml }}
          />
        </details>
      )}
      {all.some((x) => x.parentId === c.id) && (
        <div className="category-links">
          {all
            .filter((x) => x.parentId === c.id)
            .map((x) => (
              <Link href={`/kategoria/${x.slug}`} key={x.id}>
                {x.name}
              </Link>
            ))}
        </div>
      )}
      <ProductGrid products={items} />
      {!items.length && (
        <div className="empty-state">
          <h2>Nie znaleźliśmy takiego produktu</h2>
          <p>
            Spróbuj krótszej nazwy albo samej lepkości, na przykład „5W30”.
            Możesz też napisać do nas, dobierzemy olej do silnika.
          </p>
          <Link
            className="btn btn-primary"
            href={`/katalog?q=${encodeURIComponent(q)}`}
          >
            Szukaj w całym sklepie
          </Link>
        </div>
      )}
      <CatalogPagination
        page={page}
        pages={catalog.pages}
        search={q}
        grade={grade}
        path={`/kategoria/${slug}`}
      />
    </main>
  );
}
