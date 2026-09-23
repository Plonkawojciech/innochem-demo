import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { database, query, transaction } from "../lib/server/db";
import { resolveRedirect } from "../lib/server/redirects";
type Row = Record<string, string>;
// Exact source identities, checked against Polish product names. 455 is no longer in the source shop.
const wpProducts: Record<string, number> = {
  439: 11,
  441: 12,
  443: 13,
  445: 14,
  447: 15,
  449: 16,
  451: 17,
  453: 18,
  457: 20,
  459: 21,
  461: 22,
  463: 23,
  465: 24,
  467: 25,
  469: 26,
  471: 27,
  473: 28,
  475: 29,
  477: 30,
  479: 31,
  524: 32,
  522: 33,
  520: 34,
  535: 35,
  533: 36,
  531: 37,
  528: 38,
  526: 39,
  831: 41,
  866: 43,
  871: 44,
};
const wpPages: Record<string, string> = {
  6: "/",
  20: "/o-firmie",
  23: "/kontakt",
  46: "/dystrybutorzy",
  1105: "/polityka-cookies",
};
const cms: Record<string, string> = {
  1: "/dostawa-i-platnosci",
  2: "/polityka-prywatnosci",
  3: "/regulamin",
  4: "/o-firmie",
  5: "/dostawa-i-platnosci",
  6: "/polityka-cookies",
};
const industrial: Record<string, string> = {
  "oleje-przemyslowe": "",
  "oleje-i-smary-przekladniowe": "przekladnie",
  "smary-do-kompresorow": "kompresory",
  "oleje-do-sprezarek": "sprezarki",
  "oleje-hydrauliczne": "hydraulika",
  "inne-plyny-i-oleje": "inne",
};
async function main() {
  const source = process.argv[2];
  if (!source)
    throw new Error(
      "Usage: tsx scripts/import-redirects.ts /private/legacy-data.json [--apply] [--crawl=/private/public-pages.json]",
    );
  const { tables: t } = JSON.parse(await readFile(source, "utf8")) as {
    tables: Record<string, Row[]>;
  };
  const { rows: products } = await query(
    "SELECT legacy_id,slug,status FROM products WHERE legacy_id IS NOT NULL",
  );
  const productMap = new Map(products.map((p) => [p.legacy_id, p]));
  const { rows: categories } = await query(
    "SELECT legacy_id,slug,visible FROM categories WHERE legacy_id IS NOT NULL",
  );
  const byCategorySlug = new Map(categories.map((c) => [c.slug, c]));
  const entries = new Map<string, string | null>();
  const add = (from: string, to: string | null) => {
    const normalized = from.replace(/\/+$/, "") || "/";
    if (normalized !== to) entries.set(normalized, to);
  };
  const category = (slug: string): string | null => {
    if (slug in industrial)
      return (
        "/przemysl" + (industrial[slug] ? `?dzial=${industrial[slug]}` : "")
      );
    if (slug === "produkty" || slug === "home") return "/katalog";
    const c = byCategorySlug.get(slug);
    return c?.visible ? `/kategoria/${c.slug}` : null;
  };
  for (const p of t.product_lang.filter((p) => p.id_lang === "6")) {
    const current = productMap.get(Number(p.id_product));
    if (!current) throw new Error(`Catalog product ${p.id_product} missing`);
    const target =
      current.status === "active" ? `/produkt/${current.slug}` : null;
    add(`/sklep/product.php?id_product=${p.id_product}`, target);
    add(`/sklep/${p.id_product}-${p.link_rewrite}.html`, target);
    for (const c of t.category_lang.filter((c) => c.id_lang === "6"))
      add(
        `/sklep/${c.link_rewrite}/${p.id_product}-${p.link_rewrite}.html`,
        target,
      );
  }
  for (const c of t.category_lang.filter((c) => c.id_lang === "6")) {
    const target = category(c.link_rewrite);
    add(`/sklep/category.php?id_category=${c.id_category}`, target);
    add(`/sklep/${c.id_category}-${c.link_rewrite}`, target);
  }
  for (const term of t.wp_terms.filter((term) =>
    t.wp_term_taxonomy.some(
      (tx) => tx.term_id === term.term_id && tx.taxonomy === "category",
    ),
  )) {
    const target = category(term.slug);
    add(`/?cat=${term.term_id}`, target);
    add(`/category/${term.slug}`, target);
    add(`/${term.slug}`, target);
  }
  for (const p of t.wp_posts.filter(
    (p) =>
      p.post_status === "publish" && ["post", "page"].includes(p.post_type),
  )) {
    const product = productMap.get(wpProducts[p.ID]);
    const target =
      wpPages[p.ID] ??
      (product?.status === "active" ? `/produkt/${product.slug}` : null);
    add(`/${p.post_name}`, target);
    add(`/?p=${p.ID}`, target);
    add(`/?page_id=${p.ID}`, target);
  }
  for (const c of t.cms_lang.filter((c) => c.id_lang === "6")) {
    add(`/sklep/cms.php?id_cms=${c.id_cms}`, cms[c.id_cms] ?? null);
    add(`/sklep/content/${c.id_cms}-${c.link_rewrite}`, cms[c.id_cms] ?? null);
  }
  for (const [from, to] of Object.entries({
    "/index.php": "/",
    "/sklep": "/katalog",
    "/sklep/index.php": "/katalog",
    "/sklep/contact-form.php": "/kontakt",
    "/sklep/stores": "/kontakt",
    "/sklep/my-account.php": "/konto",
    "/sklep/authentication.php": "/konto",
    "/sklep/history.php": "/konto",
    "/sklep/order.php": "/zamowienie",
    "/sklep/order-opc.php": "/zamowienie",
    "/sklep/password.php": "/konto?tryb=haslo",
    "/cookie-policy": "/polityka-cookies",
  }))
    add(from, to);
  // All extant originals, including product images, PDFs and encoded historical filenames.
  const { rows: media } = await query(
    "SELECT source_path,path FROM media WHERE source_system IN ('legacy-file','prestashop')",
  );
  for (const m of media)
    add(
      `/${m.source_path}`,
      m.path.split("/").map(encodeURIComponent).join("/"),
    );
  const report = {
    mode: process.argv.includes("--apply") ? "apply" : "dry-run",
    redirects: entries.size,
    permanent: [...entries.values()].filter(Boolean).length,
    gone: [...entries.values()].filter((v) => v === null).length,
    crawl: [] as unknown[],
  };
  if (report.mode === "apply") {
    await transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(842615913)");
      for (const [from, to] of entries)
        await db.query(
          "INSERT INTO redirects(source_path,destination_path,status) VALUES($1,$2,$3) ON CONFLICT(source_path) DO UPDATE SET destination_path=excluded.destination_path,status=excluded.status",
          [from, to, to ? 301 : 410],
        );
    });
    const crawlPath = process.argv
      .find((a) => a.startsWith("--crawl="))
      ?.slice(8);
    if (crawlPath) {
      for (const item of JSON.parse(await readFile(crawlPath, "utf8"))) {
        const url = new URL(item.url);
        const result = await resolveRedirect(url);
        report.crawl.push({
          path: url.pathname + url.search,
          sourceStatus: item.status,
          result,
        });
      }
    }
  }
  await writeFile(
    path.join(path.dirname(source), "redirect-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ ...report, crawl: report.crawl.length }));
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Redirect import failed");
    process.exitCode = 1;
  })
  .finally(() => database().end());
