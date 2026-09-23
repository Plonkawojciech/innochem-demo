import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { database, transaction } from "../lib/server/db";
import { cleanHtml, plainText } from "../lib/server/content";
import path from "node:path";

type Row = Record<string, string>;
const archiveIds = new Set([41, 43, 44]);
function slug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function rewrite(html: string) {
  return cleanHtml(
    html.replace(
      /https?:\/\/(?:www\.)?innochem\.pl\/(wp-content\/uploads\/|sklep\/img\/)/g,
      "/media/$1",
    ),
  );
}
async function main() {
  const source = process.argv[2];
  if (!source)
    throw new Error(
      "Usage: npm run db:import -- /private/path/legacy-data.json [--apply]",
    );
  const content = await readFile(source, "utf8");
  const { tables: t } = JSON.parse(content) as {
    tables: Record<string, Row[]>;
  };
  const language = t.lang.find((r) => r.iso_code === "pl");
  const country = t.country.find((r) => r.iso_code === "PL");
  if (!language || !country)
    throw new Error("Polish language/country missing in source");
  const languageId = language.id_lang;
  const names = new Map(
    t.product_lang
      .filter((r) => r.id_lang === languageId)
      .map((r) => [r.id_product, r]),
  );
  const catNames = new Map(
    t.category_lang
      .filter((r) => r.id_lang === languageId)
      .map((r) => [r.id_category, r]),
  );
  const inventory = JSON.parse(
    await readFile(
      path.join(path.dirname(source), "media-inventory.json"),
      "utf8",
    ),
  ) as {
    source_path: string;
    path: string;
    size_bytes: number;
    sha256: string;
  }[];
  const images = new Map(inventory.map((r) => [r.source_path, r]));
  const report = {
    products: t.product.length,
    categories: t.category.length,
    sourceMedia: inventory.length,
    archivedProducts: 0,
    missingProductImages: [] as string[],
    mode: process.argv.includes("--apply") ? "apply" : "dry-run",
    sourceHash: createHash("sha256").update(content).digest("hex"),
  };
  const normalized = t.product.map((p) => {
    const name = names.get(p.id_product);
    if (!name) throw new Error(`Missing product text: ${p.id_product}`);
    const sourceImage = t.image.find(
      (i) => i.id_product === p.id_product && i.cover === "1",
    );
    const mediaPath = sourceImage
      ? `sklep/img/p/${p.id_product}-${sourceImage.id_image}.jpg`
      : null;
    const image = mediaPath ? images.get(mediaPath) : null;
    if (!image) report.missingProductImages.push(p.id_product);
    const taxRule = t.tax_rule.find(
      (r) =>
        r.id_tax_rules_group === p.id_tax_rules_group &&
        r.id_country === country.id_country,
    );
    const taxRate =
      p.id_tax_rules_group === "0"
        ? 0
        : Number(t.tax.find((r) => r.id_tax === taxRule?.id_tax)?.rate);
    if (!Number.isFinite(taxRate))
      throw new Error(`Unmapped tax: ${p.id_product}`);
    const archived = archiveIds.has(Number(p.id_product));
    if (archived) report.archivedProducts++;
    const productSlug =
      p.id_product === "16"
        ? "hps-5w30"
        : slug(name.link_rewrite || name.name) + "-" + p.id_product;
    return {
      p,
      name,
      image,
      productSlug,
      taxRate,
      archived,
      price: Math.round(Number(p.price) * (1 + taxRate / 100) * 100),
    };
  });
  // A source product may never have had a picture. Preserve that fact rather
  // than silently substituting another oil bottle or dropping the product.
  if (report.mode === "dry-run") {
    console.log(JSON.stringify(report));
    return;
  }
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(842615913)");
    const live = await db.query(
      "SELECT count(*)::int AS count FROM orders WHERE legacy_id IS NULL",
    );
    if (live.rows[0].count > 0)
      throw new Error(
        "Full catalog import is blocked after new orders. Use a reviewed delta import.",
      );
    const categories = new Map<string, string>();
    for (const c of t.category) {
      const n = catNames.get(c.id_category);
      if (!n) throw new Error("Missing category translation");
      const { rows } = await db.query(
        `INSERT INTO categories(legacy_id,slug,name,description_html,visible,position) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(legacy_id) DO UPDATE SET name=excluded.name,description_html=excluded.description_html,visible=excluded.visible RETURNING id`,
        [
          Number(c.id_category),
          slug(n.link_rewrite || n.name),
          n.name,
          rewrite(n.description || ""),
          !["1", "10", "11"].includes(c.id_category),
          Number(c.position),
        ],
      );
      categories.set(c.id_category, rows[0].id);
    }
    for (const c of t.category)
      await db.query("UPDATE categories SET parent_id=$1 WHERE id=$2", [
        categories.get(c.id_parent) || null,
        categories.get(c.id_category),
      ]);
    for (const n of normalized) {
      const { p, name, image } = n;
      const result = await db.query(
        `INSERT INTO products(legacy_id,slug,sku,name,summary,description_html,price_cents,tax_rate,stock,status,image_path,image_alt,meta_title,meta_description,weight_grams)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT(legacy_id) DO UPDATE SET name=excluded.name,summary=excluded.summary,description_html=excluded.description_html,price_cents=excluded.price_cents,tax_rate=excluded.tax_rate,stock=excluded.stock,status=excluded.status,image_path=excluded.image_path,updated_at=now() RETURNING id`,
        [
          Number(p.id_product),
          n.productSlug,
          p.reference,
          name.name,
          plainText(name.description_short || ""),
          rewrite(name.description || ""),
          n.price,
          n.taxRate,
          Number(p.quantity),
          n.archived ? "archived" : p.active === "1" ? "active" : "draft",
          image?.path,
          name.name,
          name.meta_title || name.name,
          name.meta_description ||
            plainText(name.description_short || "").slice(0, 160),
          Math.round(Number(p.weight) * 1000),
        ],
      );
      const id = result.rows[0].id;
      for (const rel of t.category_product.filter(
        (x) => x.id_product === p.id_product,
      ))
        await db.query(
          "INSERT INTO product_categories(product_id,category_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [id, categories.get(rel.id_category)],
        );
      await db.query(
        "INSERT INTO price_history(product_id,price_cents) SELECT $1,$2 WHERE NOT EXISTS(SELECT 1 FROM price_history WHERE product_id=$1)",
        [id, n.price],
      );
      if (image)
        await db.query(
          `INSERT INTO media(source_system,source_id,source_path,path,mime_type,size_bytes,sha256,alt,product_id) VALUES('prestashop',$1,$2,$3,'image/jpeg',$4,$5,$6,$7)
        ON CONFLICT(source_system,source_id) DO UPDATE SET sha256=excluded.sha256,path=excluded.path`,
          [
            p.id_product,
            image.source_path,
            image.path,
            image.size_bytes,
            image.sha256,
            name.name,
            id,
          ],
        );
      for (const sourcePath of [
        `/sklep/product.php?id_product=${p.id_product}`,
        `/sklep/${p.id_product}-${name.link_rewrite}.html`,
      ])
        await db.query(
          "INSERT INTO redirects(source_path,destination_path,status) VALUES($1,$2,$3) ON CONFLICT(source_path) DO UPDATE SET destination_path=excluded.destination_path,status=excluded.status",
          [
            sourcePath,
            n.archived ? null : `/produkt/${n.productSlug}`,
            n.archived ? 410 : 301,
          ],
        );
    }
    await db.query(
      "INSERT INTO import_runs(source_hash,mode,report) VALUES($1,$2,$3)",
      [report.sourceHash, report.mode, JSON.stringify(report)],
    );
  });
  console.log(JSON.stringify(report));
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Import failed");
    process.exitCode = 1;
  })
  .finally(() => database().end());
