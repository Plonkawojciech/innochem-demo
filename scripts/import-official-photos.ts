/** Imports reviewed manufacturer assets without deleting historical photos. */
import {
  readFile,
  mkdir,
  copyFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { query, transaction, database } from "../lib/server/db";
const assetSchema = z.object({
  localPath: z.string(),
  url: z.url(),
  sourcePage: z.url(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive(),
  mimeType: z.enum(["image/webp", "image/png", "image/jpeg"]),
  retrievedAt: z.iso.datetime({ offset: true }),
  side: z.enum(["front", "back"]),
});
const manifestSchema = z.object({
  reviewedAt: z.iso.datetime({ offset: true }),
  mappings: z
    .array(
      z.object({
        legacyId: z.number().int().positive(),
        expectedName: z.string(),
        expectedVersion: z.number().int().positive(),
        evidence: z.string().min(10),
        assets: z.array(assetSchema).min(1).max(10),
      }),
    )
    .min(1),
});
async function main() {
  const filename = process.argv[2],
    apply = process.argv.includes("--apply");
  if (!filename || !process.env.MEDIA_ROOT)
    throw new Error("Provide a reviewed manifest and MEDIA_ROOT");
  if (process.env.STOREFRONT_PREVIEW !== "true")
    throw new Error("This migration is limited to the preview store");
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(filename, "utf8")),
  );
  if (
    new Set(manifest.mappings.map((m) => m.legacyId)).size !==
    manifest.mappings.length
  )
    throw new Error("Duplicate product mapping");
  type ImportedAsset = z.infer<typeof assetSchema> & {
    relative: string;
    publicPath: string;
    sourceId: string;
  };
  const root = await realpath(process.env.MEDIA_ROOT);
  const rows: (Omit<
    z.infer<typeof manifestSchema>["mappings"][number],
    "assets"
  > & { productId: string; assets: ImportedAsset[] })[] = [];
  for (const mapping of manifest.mappings) {
    if (mapping.assets[0].side !== "front")
      throw new Error("Cover must be the reviewed front image");
    const product = (
      await query(
        "SELECT id,name,version,image_path FROM products WHERE legacy_id=$1",
        [mapping.legacyId],
      )
    ).rows[0];
    if (!product || product.name !== mapping.expectedName)
      throw new Error(`Product mismatch: ${mapping.legacyId}`);
    const assets = [];
    for (const a of mapping.assets) {
      for (const source of [a.url, a.sourcePage])
        if (new URL(source).origin !== "https://www.royalpurple.com")
          throw new Error("Manufacturer origin mismatch");
      const bytes = await readFile(a.localPath);
      if (
        bytes.length !== a.sizeBytes ||
        createHash("sha256").update(bytes).digest("hex") !== a.sha256
      )
        throw new Error("Image checksum mismatch");
      const meta = await sharp(bytes, {
        limitInputPixels: 40000000,
      }).metadata();
      const ext =
        a.mimeType === "image/webp"
          ? "webp"
          : a.mimeType === "image/png"
            ? "png"
            : "jpg";
      if (
        meta.format !== (ext === "jpg" ? "jpeg" : ext) ||
        !meta.width ||
        !meta.height
      )
        throw new Error("Image format mismatch");
      await sharp(bytes).resize(1, 1).raw().toBuffer();
      const relative = `official/2026-09-23/${mapping.legacyId}-${a.sha256.slice(0, 20)}.${ext}`;
      assets.push({
        ...a,
        relative,
        publicPath: `/media/${relative}`,
        sourceId: `${mapping.legacyId}:${a.sha256}`,
      });
      if (apply) {
        await mkdir(path.join(root, "official/2026-09-23"), {
          recursive: true,
        });
        const target = path.join(root, relative);
        try {
          await copyFile(a.localPath, target, constants.COPYFILE_EXCL);
        } catch (e) {
          if (!(
            e &&
            typeof e === "object" &&
            "code" in e &&
            e.code === "EEXIST"
          ))
            throw e;
          if (
            createHash("sha256")
              .update(await readFile(target))
              .digest("hex") !== a.sha256
          )
            throw new Error("Existing media differs");
        }
      }
    }
    rows.push({ ...mapping, productId: product.id as string, assets });
  }
  const results = apply
    ? await transaction(async (db) => {
        const report = [];
        for (const row of rows.sort((a, b) =>
          a.productId.localeCompare(b.productId),
        )) {
          const current = (
            await db.query(
              "SELECT id,version,image_path FROM products WHERE id=$1 FOR UPDATE",
              [row.productId],
            )
          ).rows[0];
          const gallery = (
            await db.query(
              "SELECT id,path,position FROM media WHERE product_id=$1 AND mime_type LIKE 'image/%' ORDER BY position,id",
              [row.productId],
            )
          ).rows;
          if (
            current.image_path === row.assets[0].publicPath &&
            gallery.length === row.assets.length &&
            gallery.every((m, i) => m.path === row.assets[i].publicPath)
          ) {
            report.push({ legacyId: row.legacyId, replayed: true });
            continue;
          }
          if (current.version !== row.expectedVersion)
            throw new Error(`Product changed since review: ${row.legacyId}`);
          await db.query(
            "UPDATE media SET product_id=NULL WHERE product_id=$1 AND mime_type LIKE 'image/%'",
            [row.productId],
          );
          for (const [index, a] of row.assets.entries())
            await db.query(
              `INSERT INTO media(source_system,source_id,source_path,path,mime_type,size_bytes,sha256,alt,product_id,position) VALUES('royal-purple-official',$1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(source_system,source_id) DO UPDATE SET product_id=excluded.product_id,position=excluded.position,alt=excluded.alt`,
              [
                a.sourceId,
                a.url,
                a.publicPath,
                a.mimeType,
                a.sizeBytes,
                a.sha256,
                `${row.expectedName} — ${a.side === "front" ? "przód" : "tył"} opakowania`,
                row.productId,
                index,
              ],
            );
          await db.query(
            "UPDATE products SET image_path=$2,image_alt=$3,version=version+1,updated_at=now() WHERE id=$1",
            [row.productId, row.assets[0].publicPath, row.expectedName],
          );
          await db.query(
            "INSERT INTO audit_log(actor_id,action,entity_id,data) VALUES('migration:official-photos','product.photos_replaced',$1,$2)",
            [
              row.productId,
              JSON.stringify({
                oldCover: current.image_path,
                oldGallery: gallery,
                newAssets: row.assets.map((a) => ({
                  path: a.publicPath,
                  sha256: a.sha256,
                  url: a.url,
                  sourcePage: a.sourcePage,
                  retrievedAt: a.retrievedAt,
                })),
                evidence: row.evidence,
                reviewedAt: manifest.reviewedAt,
              }),
            ],
          );
          report.push({
            legacyId: row.legacyId,
            photos: row.assets.length,
            previousPhotosPreserved: gallery.length,
          });
        }
        return report;
      })
    : rows.map((r) => ({
        legacyId: r.legacyId,
        photos: r.assets.length,
        expectedVersion: r.expectedVersion,
      }));
  const report = {
    applied: apply,
    products: rows.length,
    assets: rows.reduce((n, r) => n + r.assets.length, 0),
    results,
    finishedAt: new Date().toISOString(),
  };
  await writeFile(
    `${filename}.${apply ? "applied" : "dry-run"}.json`,
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Import failed");
    process.exitCode = 1;
  })
  .finally(() => database().end());
