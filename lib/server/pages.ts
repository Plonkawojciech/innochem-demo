import { query } from "./db";
export async function informationPage(slug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 180)
    return null;
  const {
    rows: [page],
  } = await query(
    "SELECT slug,title,body_html,meta_description,published,updated_at FROM pages WHERE slug=$1 AND (published OR ($2 AND source_system='store-draft'))",
    [slug, process.env.STOREFRONT_PREVIEW !== "false"],
  );
  return page ?? null;
}
