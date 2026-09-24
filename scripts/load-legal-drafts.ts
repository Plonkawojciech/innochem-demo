/** Loads reviewed legal drafts from docs/legal into unpublished pages. Never publishes or approves. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { transaction, database } from "../lib/server/db";
import { cleanHtml } from "../lib/server/content";
import { legalSlugs } from "../lib/server/legal";
const titles: Record<string, string> = {
  regulamin: "Regulamin sklepu",
  "polityka-prywatnosci": "Polityka prywatności",
  "zwroty-i-reklamacje": "Zwroty i reklamacje",
  "dostawa-i-platnosci": "Dostawa i płatności",
  "polityka-cookies": "Polityka cookies",
};
async function main() {
  const apply = process.argv.includes("--apply");
  if (process.env.STOREFRONT_PREVIEW !== "true")
    throw new Error("Legal drafts are loaded only into the preview store");
  const drafts: { slug: string; html: string; title: string }[] = [];
  for (const slug of legalSlugs) {
    const html = cleanHtml(
      await readFile(path.join("docs/legal", `${slug}.html`), "utf8"),
    );
    if (html.length < 500) throw new Error(`Draft too short: ${slug}`);
    drafts.push({ slug, html, title: titles[slug] });
  }
  if (!apply) {
    console.log(
      JSON.stringify(
        drafts.map((d) => ({ slug: d.slug, bytes: d.html.length })),
      ),
    );
    return;
  }
  await transaction(async (db) => {
    for (const d of drafts) {
      const { rowCount } = await db.query(
        "UPDATE pages SET title=$2,body_html=$3,published=false,version=version+1,updated_at=now() WHERE slug=$1 AND source_system='store-draft'",
        [d.slug, d.title, d.html],
      );
      if (rowCount !== 1) throw new Error(`Draft page missing: ${d.slug}`);
      console.log(`Updated draft ${d.slug} (${d.html.length} bytes)`);
    }
  });
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Failed");
    process.exitCode = 1;
  })
  .finally(() => database().end());
