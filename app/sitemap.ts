import type { MetadataRoute } from "next";
import { query } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (process.env.STOREFRONT_PREVIEW !== "false") return [];
  const base = process.env.APP_URL || "https://innochem.pl";
  const { rows } =
    await query(`SELECT '/produkt/'||slug AS path,updated_at FROM products WHERE status='active'
 UNION ALL SELECT '/'||slug,updated_at FROM pages WHERE published
 UNION ALL SELECT '/kategoria/'||slug,NULL::timestamptz FROM categories WHERE visible AND legacy_id IS DISTINCT FROM 1 AND slug NOT IN ('oleje-przemyslowe','oleje-i-smary-przekladniowe','smary-do-kompresorow','oleje-do-sprezarek','oleje-hydrauliczne','inne-plyny-i-oleje')`);
  return [
    ...new Map(
      [
        ...["/", "/katalog", "/przemysl", "/kontakt", "/dystrybutorzy"].map(
          (path) => ({ path, updated_at: null }),
        ),
        ...rows,
      ].map((r) => [
        r.path,
        {
          url: new URL(r.path, base).href,
          ...(r.updated_at ? { lastModified: r.updated_at } : {}),
        },
      ]),
    ).values(),
  ];
}
