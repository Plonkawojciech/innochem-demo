/** Reproduce the mobile derivative of the existing, unmodified default hero. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";

const root = new URL("../public/", import.meta.url);
const source = await readFile(new URL("hero-olej.webp", root));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (
  hash(source) !==
  "b242da1e4c9ec428a3f3c7cb171aeed0c1781dbf7144e0e05fb13f1c1391b4f9"
)
  throw new Error(
    "Default hero changed; review crop and content-addressed name",
  );
const variants = [
  {
    name: "hero-olej-mobile-855b096a504ba167.avif",
    left: 288,
    width: 960,
    sha256: "855b096a504ba167cd63d977fb299ead3487467df0d96315de2251218468ed58",
  },
  {
    name: "hero-olej-small-d4f01e0e78905be3.avif",
    left: 512,
    width: 512,
    sha256: "d4f01e0e78905be3aac30f3c783d8f4a67de1c8ecdd9f589c967dc811924d1a1",
  },
];
for (const variant of variants) {
  if (process.argv.includes("--check")) {
    if (hash(await readFile(new URL(variant.name, root))) !== variant.sha256)
      throw new Error("Hero crop does not match its immutable asset name");
    continue;
  }
  // The audited layout exposes only these centred bands at the selected widths.
  // CMS layout changes bypass both crops and retain the full original image.
  const output = await sharp(source)
    .extract({ left: variant.left, top: 0, width: variant.width, height: 1024 })
    .avif({ quality: 55, effort: 4 })
    .toBuffer();
  if (hash(output) !== variant.sha256)
    throw new Error("Encoder output changed; review and update the asset hash");
  await writeFile(new URL(variant.name, root), output);
}
console.log("Default hero input and both mobile asset hashes verified");
