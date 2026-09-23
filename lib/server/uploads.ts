import { mkdir, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { transaction } from "./db";
import { audit } from "./admin";
import { StoreError } from "./orders";

export async function validateUpload(bytes: Buffer) {
  if (!bytes.length || bytes.length > 15 * 1024 * 1024)
    throw new StoreError("FILE_SIZE", "Plik musi mieć od 1 B do 15 MB.", 413);
  if (bytes.subarray(0, 5).toString() === "%PDF-")
    return { extension: "pdf", mime: "application/pdf" };
  try {
    const reader = sharp(bytes, {
      limitInputPixels: 40000000,
      failOn: "error",
    });
    const metadata = await reader.metadata();
    const formats: Record<string, string> = {
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
      avif: "image/avif",
    };
    if (
      !metadata.format ||
      !formats[metadata.format] ||
      !metadata.width ||
      !metadata.height
    )
      throw new Error("format");
    // Decode pixels to reject truncated or disguised uploads, keeping the original bytes.
    await reader.resize(1, 1).raw().toBuffer();
    return {
      extension: metadata.format === "jpeg" ? "jpg" : metadata.format,
      mime: formats[metadata.format],
    };
  } catch {
    throw new StoreError(
      "FILE_FORMAT",
      "Wybierz poprawne zdjęcie JPG, PNG, WebP, GIF, AVIF albo dokument PDF.",
    );
  }
}
export async function storeUpload(bytes: Buffer, actor: string, alt = "") {
  const type = await validateUpload(bytes);
  const root = process.env.MEDIA_ROOT;
  if (!root)
    throw new StoreError(
      "MEDIA_UNAVAILABLE",
      "Magazyn plików nie jest skonfigurowany.",
      503,
    );
  const base = await realpath(root);
  await mkdir(path.join(base, "uploads"), { recursive: true, mode: 0o750 });
  const directory = await realpath(path.join(base, "uploads"));
  if (!directory.startsWith(base + path.sep))
    throw new Error("Unsafe media directory");
  const id = randomUUID(),
    relative = `uploads/${id}.${type.extension}`;
  await writeFile(path.join(base, relative), bytes, {
    flag: "wx",
    mode: 0o640,
  });
  // A failed DB write may leave an unreferenced file; never remove existing media.
  return transaction(async (db) => {
    const {
      rows: [media],
    } = await db.query(
      "INSERT INTO media(id,source_system,source_id,source_path,path,mime_type,size_bytes,sha256,alt) VALUES($1::uuid,'upload',$1::text,'',$2,$3,$4,$5,$6) RETURNING id,path,mime_type,alt",
      [
        id,
        `/media/${relative}`,
        type.mime,
        bytes.length,
        createHash("sha256").update(bytes).digest("hex"),
        alt.slice(0, 300),
      ],
    );
    await audit(db, actor, "media.uploaded", id, {
      path: relative,
      size: bytes.length,
    });
    return media;
  });
}
