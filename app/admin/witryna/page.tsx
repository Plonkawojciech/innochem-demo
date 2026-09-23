import { adminPageUser } from "@/lib/server/admin-page";
import { query } from "@/lib/server/db";
import { siteState } from "@/lib/server/site-content";
import { SiteEditor } from "../SiteEditor";
export default async function SitePage() {
  await adminPageUser();
  const [state, products, revisions] = await Promise.all([
    siteState(),
    query("SELECT id,name FROM products WHERE status='active' ORDER BY name"),
    query(
      "SELECT id,action,created_at FROM site_revisions ORDER BY created_at DESC LIMIT 50",
    ),
  ]);
  return (
    <>
      <h2 className="display">Wygląd i treści witryny</h2>
      <SiteEditor
        initial={state.draft}
        version={state.version}
        products={products.rows as { id: string; name: string }[]}
        revisions={revisions.rows.map((r) => ({
          id: r.id,
          action: r.action,
          createdAt: r.created_at.toISOString(),
        }))}
        preview={process.env.STOREFRONT_PREVIEW !== "false"}
      />
    </>
  );
}
