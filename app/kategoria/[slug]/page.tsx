import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { products, categories, catalogPage } from "@/lib/server/catalog";
import { CatalogPagination } from "@/components/CatalogPagination";
import { ProductGrid } from "@/components/ProductCard";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const page = catalogPage((await searchParams).page);
  const c = (await categories()).find((c) => c.slug === slug);
  return {
    title: `${c?.name || "Kategoria"} — INNOCHEM${page > 1 ? ` — strona ${page}` : ""}`,
    alternates: {
      canonical: `/kategoria/${slug}${page > 1 ? `?page=${page}` : ""}`,
    },
  };
}
export default async function Category({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
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
  const page = catalogPage((await searchParams).page);
  const catalog = await products({ category: slug, page });
  if (page > catalog.pages) notFound();
  const { items } = catalog;
  return (
    <main className="wrap catalog-page">
      <p className="crumbs">
        <Link href="/katalog">Produkty</Link> / {c.name}
      </p>
      <div className="catalog-heading">
        <h1 className="display">{c.name}</h1>
        {c.descriptionHtml && (
          <div
            className="prose"
            dangerouslySetInnerHTML={{ __html: c.descriptionHtml }}
          />
        )}
      </div>
      <div className="category-links">
        {all
          .filter((x) => x.parentId === c.id)
          .map((x) => (
            <Link href={`/kategoria/${x.slug}`} key={x.id}>
              {x.name}
            </Link>
          ))}
      </div>
      <ProductGrid products={items} />
      {!items.length && (
        <div className="empty-state">
          <p>Obecnie nie ma produktów w tej kategorii.</p>
          <Link href="/kontakt">Zapytaj o dostępność</Link>
        </div>
      )}
      <CatalogPagination
        page={page}
        pages={catalog.pages}
        path={`/kategoria/${slug}`}
      />
    </main>
  );
}
