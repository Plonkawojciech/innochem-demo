import { database, query } from "../lib/server/db";
import { defaultSiteContent } from "../lib/site-content";
import { saveSiteContent, siteState } from "../lib/server/site-content";
async function main() {
  if (process.env.STOREFRONT_PREVIEW !== "true")
    throw new Error("Preview only");
  const state = await siteState();
  if (state.version) {
    console.log("Site content already exists; preserved without changes.");
    return;
  }
  const product = (
    await query(
      "SELECT id,slug FROM products WHERE legacy_id=16 AND status='active'",
    )
  ).rows[0];
  const content = structuredClone(defaultSiteContent);
  if (product)
    for (const f of [content.home.hero, content.home.featured]) {
      f.productId = product.id;
      f.link.href = `/produkt/${product.slug}`;
    }
  const result = await saveSiteContent(
    { action: "publish", version: 0, value: content },
    "migration:site",
  );
  console.log(
    JSON.stringify({
      version: result.version,
      featuredProductLinked: !!product,
    }),
  );
}
main()
  .finally(() => database().end())
  .catch(() => {
    console.error("Site initialization failed");
    process.exitCode = 1;
  });
