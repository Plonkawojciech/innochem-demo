import { readFile, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { database, transaction } from "../lib/server/db";
import { cleanHtml, plainText } from "../lib/server/content";
type Row = Record<string, string>;
type Media = {
  source_path: string;
  path: string;
  size_bytes: number;
  sha256: string;
};
const mime: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".odt": "application/vnd.oasis.opendocument.text",
};
async function main() {
  const source = process.argv[2];
  if (!source)
    throw new Error(
      "Usage: tsx scripts/import-media-content.ts /private/path/legacy-data.json [--apply]",
    );
  const bytes = await readFile(source);
  const { tables: t } = JSON.parse(bytes.toString()) as {
    tables: Record<string, Row[]>;
  };
  const directory = path.dirname(source),
    root = await realpath(path.join(directory, "media"));
  const media = JSON.parse(
    await readFile(path.join(directory, "media-inventory.json"), "utf8"),
  ) as Media[];
  const report = {
    mode: process.argv.includes("--apply") ? "apply" : "dry-run",
    verifiedFiles: 0,
    verifiedBytes: 0,
    galleryImages: 0,
    productsWithoutImage: [] as string[],
    archivedPages: 0,
    sourceRecords: 0,
    skippedEditedProducts: [] as string[],
  };
  const byPath = new Map(media.map((m) => [m.source_path, m]));
  for (const m of media) {
    const file = await realpath(path.resolve(root, m.source_path));
    if (
      !file.startsWith(root + path.sep) ||
      m.path !== `/media/${m.source_path}` ||
      !mime[path.extname(file).toLowerCase()]
    )
      throw new Error("Invalid media manifest path");
    const data = await readFile(file);
    if (
      data.length !== m.size_bytes ||
      createHash("sha256").update(data).digest("hex") !== m.sha256
    )
      throw new Error(`Media integrity mismatch: ${m.source_path}`);
    report.verifiedFiles++;
    report.verifiedBytes += data.length;
  }
  const gallery = t.image.map((i) => {
    const m = byPath.get(`sklep/img/p/${i.id_product}-${i.id_image}.jpg`);
    if (!m) throw new Error(`Missing source image: ${i.id_image}`);
    return { image: i, media: m };
  });
  report.galleryImages = gallery.length;
  report.productsWithoutImage = t.product
    .filter((p) => !t.image.some((i) => i.id_product === p.id_product))
    .map((p) => p.id_product);
  const wpPages = t.wp_posts.filter(
    (p) =>
      p.post_status === "publish" && ["post", "page"].includes(p.post_type),
  );
  report.archivedPages = wpPages.length;
  const archiveTables = [
    "wp_posts",
    "wp_postmeta",
    "wp_terms",
    "wp_term_taxonomy",
    "wp_term_relationships",
    "cms",
    "cms_lang",
  ];
  report.sourceRecords = archiveTables.reduce(
    (n, table) => n + (t[table]?.length || 0),
    0,
  );
  if (report.mode === "apply")
    await transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(842615913)");
      for (const m of media)
        await db.query(
          "INSERT INTO media(source_system,source_id,source_path,path,mime_type,size_bytes,sha256) VALUES('legacy-file',$1,$1,$2,$3,$4,$5) ON CONFLICT(path) DO NOTHING",
          [
            m.source_path,
            m.path,
            mime[path.extname(m.source_path).toLowerCase()],
            m.size_bytes,
            m.sha256,
          ],
        );
      for (const g of gallery) {
        const {
          rows: [product],
        } = await db.query(
          "SELECT id,name,version FROM products WHERE legacy_id=$1 FOR UPDATE",
          [Number(g.image.id_product)],
        );
        if (!product) throw new Error("Import the product catalog first");
        if (product.version > 1) {
          if (!report.skippedEditedProducts.includes(g.image.id_product))
            report.skippedEditedProducts.push(g.image.id_product);
          continue;
        }
        await db.query(
          "UPDATE media SET product_id=$1,position=$2,alt=$3 WHERE path=$4",
          [
            product.id,
            g.image.cover === "1" ? 0 : Number(g.image.position),
            product.name,
            g.media.path,
          ],
        );
      }
      for (const table of archiveTables)
        for (const [index, row] of (t[table] || []).entries()) {
          const key =
            table === "wp_posts"
              ? row.ID
              : table === "wp_postmeta"
                ? row.meta_id
                : table === "wp_terms"
                  ? row.term_id
                  : table === "wp_term_taxonomy"
                    ? row.term_taxonomy_id
                    : table === "cms"
                      ? row.id_cms
                      : table === "cms_lang"
                        ? `${row.id_cms}:${row.id_lang}`
                        : `${row.object_id}:${row.term_taxonomy_id}:${index}`;
          await db.query(
            "INSERT INTO legacy_records(source_table,source_id,data) VALUES($1,$2,$3) ON CONFLICT(source_table,source_id) DO NOTHING",
            [table, key, JSON.stringify(row)],
          );
        }
      for (const p of wpPages) {
        // The requested removal of the old knowledge base is preserved: all
        // historical articles remain editable drafts, not automatically public.
        const html = cleanHtml(
          p.post_content.replace(
            /https?:\/\/(?:www\.)?innochem\.pl\/(wp-content\/uploads\/|sklep\/img\/)/g,
            "/media/$1",
          ),
        );
        await db.query(
          "INSERT INTO pages(slug,title,body_html,meta_description,published,source_system,source_id) VALUES($1,$2,$3,$4,false,'wordpress',$5) ON CONFLICT(source_system,source_id) DO NOTHING",
          [
            `archiwum-wp-${p.ID}`,
            plainText(p.post_title) || `Archiwum ${p.ID}`,
            html,
            plainText(p.post_excerpt || p.post_content).slice(0, 320),
            p.ID,
          ],
        );
      }
      await db.query(
        "INSERT INTO import_runs(source_hash,mode,report) VALUES($1,'media-content',$2)",
        [
          createHash("sha256").update(bytes).digest("hex"),
          JSON.stringify(report),
        ],
      );
    });
  await writeFile(
    path.join(directory, "media-content-report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Import failed");
    process.exitCode = 1;
  })
  .finally(() => database().end());
