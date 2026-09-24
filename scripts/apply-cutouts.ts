/**
 * Installs background-free product renders (PNG with alpha) as the cover image of
 * each product, keeping the previous cover in the gallery. Expects a directory of
 * files named <legacyId>.png. Never deletes files and refuses non-alpha images.
 */
import { readdir, readFile, mkdir, copyFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { transaction, database } from "../lib/server/db";
const folder = "official/cutouts-2026-09-24";
async function main() {
  const dir = process.argv[2],
    apply = process.argv.includes("--apply");
  if (!dir || !process.env.MEDIA_ROOT)
    throw new Error("Provide the cutout directory and MEDIA_ROOT");
  if (process.env.STOREFRONT_PREVIEW !== "true")
    throw new Error("Limited to the preview store");
  const root = await realpath(process.env.MEDIA_ROOT);
  const report: unknown[] = [];
  await transaction(async (db) => {
    for (const file of (await readdir(dir)).filter((f) =>
      /^\d+\.png$/.test(f),
    )) {
      const legacyId = Number(file.replace(".png", ""));
      const bytes = await readFile(path.join(dir, file));
      const meta = await sharp(bytes).metadata();
      if (
        meta.format !== "png" ||
        !meta.hasAlpha ||
        !meta.width ||
        !meta.height
      )
        throw new Error(`Not an alpha PNG: ${file}`);
      const sha = createHash("sha256").update(bytes).digest("hex");
      const relative = `${folder}/${legacyId}-${sha.slice(0, 20)}.png`;
      const product = (
        await db.query(
          "SELECT id,name,image_path,version FROM products WHERE legacy_id=$1 AND status='active'",
          [legacyId],
        )
      ).rows[0];
      if (!product) throw new Error(`Unknown product ${legacyId}`);
      report.push({
        legacyId,
        name: product.name,
        relative,
        width: meta.width,
        height: meta.height,
      });
      if (!apply) continue;
      await mkdir(path.join(root, folder), { recursive: true });
      try {
        await copyFile(
          path.join(dir, file),
          path.join(root, relative),
          constants.COPYFILE_EXCL,
        );
      } catch (e) {
        if (!(e && typeof e === "object" && "code" in e && e.code === "EEXIST"))
          throw e;
      }
      // Previous cover stays attached to the product as a further gallery image.
      await db.query(
        "UPDATE media SET position=position+1 WHERE product_id=$1 AND mime_type LIKE 'image/%'",
        [product.id],
      );
      await db.query(
        `INSERT INTO media(source_system,source_id,source_path,path,mime_type,size_bytes,sha256,alt,product_id,position)
         VALUES('cutout-2026-09-24',$1,$2,$3,'image/png',$4,$5,$6,$7,0)
         ON CONFLICT(source_system,source_id) DO UPDATE SET product_id=excluded.product_id,position=0,alt=excluded.alt`,
        [
          `${legacyId}:${sha}`,
          `${dir}/${file}`,
          `/media/${relative}`,
          bytes.length,
          sha,
          `${product.name} — opakowanie`,
          product.id,
        ],
      );
      await db.query(
        "UPDATE products SET image_path=$2,version=version+1,updated_at=now() WHERE id=$1",
        [product.id, `/media/${relative}`],
      );
      await db.query(
        "INSERT INTO audit_log(actor_id,action,entity_id,data) VALUES('migration:cutouts','product.cover_replaced',$1,$2)",
        [
          product.id,
          JSON.stringify({
            previous: product.image_path,
            next: `/media/${relative}`,
          }),
        ],
      );
    }
  });
  console.log(
    JSON.stringify({ applied: apply, count: report.length, report }, null, 1),
  );
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Failed");
    process.exitCode = 1;
  })
  .finally(() => database().end());
