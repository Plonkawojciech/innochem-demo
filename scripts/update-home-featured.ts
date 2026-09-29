/** Rewrites the home "featured" block from a single product to the HPS series (2026-09-29 refresh). Idempotent. */
import { transaction } from "../lib/server/db";
const next = {
  label: "Seria HPS",
  title: "HPS – High Performance Street",
  text: "Seria syntetycznych olejów silnikowych do aut po gwarancji, tuningowanych i mocno eksploatowanych. Pakiet Synerlec oraz podwyższona zawartość cynku i fosforu chronią silnik przy wysokich obciążeniach. Dostępna w pięciu klasach lepkości.",
  linkName: "Najpopularniejszy: HPS 5W-30",
};
type Featured = {
  label: string;
  title: string;
  text: string;
  link: { name: string; href: string };
};
function patch(content: { home: { featured: Featured } }) {
  const f = content.home.featured;
  const stale =
    f.title === "Royal Purple HPS 5W-30" ||
    f.link.name === "Zobacz kartę produktu";
  if (!stale) return false;
  f.label = next.label;
  f.title = next.title;
  f.text = next.text;
  f.link.name = next.linkName;
  return true;
}
async function main() {
  const apply = process.argv.includes("--apply");
  await transaction(async (db) => {
    const {
      rows: [row],
    } = await db.query(
      "SELECT draft,published FROM site_content WHERE id=true FOR UPDATE",
    );
    if (!row) throw new Error("site_content missing");
    const changedDraft = patch(row.draft);
    const changedPublished = patch(row.published);
    console.log(
      JSON.stringify({ apply, changedDraft, changedPublished }, null, 0),
    );
    if (!apply || (!changedDraft && !changedPublished)) return;
    await db.query(
      "UPDATE site_content SET draft=$1,published=$2,version=version+1,updated_at=now() WHERE id=true",
      [row.draft, row.published],
    );
  });
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
