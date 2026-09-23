/** Restores explicit links from legacy product pages; never guesses documents by filename similarity. */
import { writeFile } from "node:fs/promises";
import { query, transaction, database } from "../lib/server/db";
import { resolveRedirect } from "../lib/server/redirects";
async function main() {
  const reportPath = process.argv[2],
    apply = process.argv.includes("--apply");
  if (!reportPath || process.env.STOREFRONT_PREVIEW !== "true")
    throw new Error("Preview store and private report path required");
  const pages = (
    await query(
      "SELECT p.id,p.legacy_id,p.version,p.name,pg.source_id,pg.body_html FROM products p JOIN redirects r ON r.destination_path='/produkt/'||p.slug AND r.source_path LIKE '/?p=%' JOIN pages pg ON pg.source_id=split_part(r.source_path,'=',2) AND pg.source_system='wordpress' ORDER BY p.legacy_id",
    )
  ).rows;
  const mappings: {
      productId: string;
      legacyId: number;
      version: number;
      wpId: string;
      documents: { mediaId: string; path: string; label: string }[];
    }[] = [],
    missing: unknown[] = [];
  for (const page of pages) {
    const references = [
      ...new Set<string>(
        (page.body_html as string).match(
          /\/(?:media\/)?wp-content\/uploads\/[^\s,"<>]+\.(?:pdf|docx?|odt)/gi,
        ) || [],
      ),
    ];
    const documents: { mediaId: string; path: string; label: string }[] = [];
    for (const reference of references) {
      let current = decodeURIComponent(reference);
      if (!current.startsWith("/media/")) {
        const redirect = await resolveRedirect(
          new URL(current, "https://innochem.pl"),
        );
        current = redirect?.destination
          ? decodeURIComponent(redirect.destination)
          : `/media${current}`;
      }
      const media = (
        await query("SELECT id,path,mime_type FROM media WHERE path=$1", [
          current,
        ])
      ).rows[0];
      if (
        !media ||
        ![
          "application/pdf",
          "application/msword",
          "application/vnd.oasis.opendocument.text",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ].includes(media.mime_type)
      ) {
        missing.push({
          legacyId: page.legacy_id,
          wpId: page.source_id,
          reference,
        });
        continue;
      }
      if (documents.some((d) => d.mediaId === media.id)) continue;
      const filename = media.path.split("/").pop() as string;
      const label = /^kch/i.test(filename)
        ? "Karta charakterystyki"
        : /^ip[-_]/i.test(filename)
          ? "Informacja o produkcie"
          : filename;
      documents.push({ mediaId: media.id, path: media.path, label });
    }
    mappings.push({
      productId: page.id,
      legacyId: page.legacy_id,
      version: page.version,
      wpId: page.source_id,
      documents,
    });
  }
  let added = 0;
  if (apply)
    await transaction(async (db) => {
      for (const m of [...mappings].sort((a, b) =>
        a.productId.localeCompare(b.productId),
      )) {
        const row = (
          await db.query(
            "SELECT version FROM products WHERE id=$1 FOR UPDATE",
            [m.productId],
          )
        ).rows[0];
        if (row.version !== m.version)
          throw new Error(`Product changed: ${m.legacyId}`);
        let changed = false;
        for (const [position, d] of m.documents.entries()) {
          const inserted = await db.query(
            "INSERT INTO product_documents(product_id,media_id,label,archival,position,source) VALUES($1,$2,$3,true,$4,'wordpress') ON CONFLICT DO NOTHING",
            [m.productId, d.mediaId, d.label, position],
          );
          if (inserted.rowCount) {
            added++;
            changed = true;
          }
        }
        if (changed) {
          await db.query(
            "UPDATE products SET version=version+1,updated_at=now() WHERE id=$1",
            [m.productId],
          );
          await db.query(
            "INSERT INTO audit_log(actor_id,action,entity_id,data) VALUES('migration:product-documents','product.documents_imported',$1,$2)",
            [
              m.productId,
              JSON.stringify({
                wpId: m.wpId,
                documents: m.documents,
                archival: true,
              }),
            ],
          );
        }
      }
    });
  const report = {
    createdAt: new Date().toISOString(),
    applied: apply,
    products: mappings.length,
    mapped: mappings.reduce((n, m) => n + m.documents.length, 0),
    added,
    missing,
    mappings,
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      applied: apply,
      products: report.products,
      mapped: report.mapped,
      added,
      missing: missing.length,
    }),
  );
}
main()
  .catch(() => {
    console.error(
      "Product document import failed; inspect the private source and transaction state.",
    );
    process.exitCode = 1;
  })
  .finally(() => database().end());
