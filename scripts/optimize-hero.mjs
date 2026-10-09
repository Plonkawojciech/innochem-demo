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
// Keep the default technology image responsive without cropping it or replacing
// images selected through the CMS. Only content-addressed outputs are cached.
const engineSource = await readFile(new URL("tlo-silnik.webp", root));
if (
  hash(engineSource) !==
  "74041e5d0333389cb65bcf0a2e0b160368197599e8276b50134d939f655d70d8"
)
  throw new Error("Default technology image changed; review its derivatives");
for (const variant of [
  {
    width: 480,
    sha256: "4e7a56fa4562236395f766e7768f9888c5daf9dd7938cd80bee1ea7425cea749",
  },
  {
    width: 800,
    sha256: "1753ea917a467a6e0e1ce5d02de9c1e68b693e6823f7e9b2111e5b6a0d167190",
  },
  {
    width: 1024,
    sha256: "f70777c1c04c694bf9f9285182dbc72fa7b86f4b896785ca0c7aa553b868ab15",
  },
]) {
  const name = `tlo-silnik-${variant.width}-${variant.sha256.slice(0, 16)}.avif`;
  if (process.argv.includes("--check")) {
    if (hash(await readFile(new URL(name, root))) !== variant.sha256)
      throw new Error(
        "Technology derivative does not match its immutable name",
      );
    continue;
  }
  const output = await sharp(engineSource)
    .resize({ width: variant.width, withoutEnlargement: true })
    .avif({ quality: 55, effort: 4 })
    .toBuffer();
  if (hash(output) !== variant.sha256)
    throw new Error("Encoder output changed; review technology asset hashes");
  await writeFile(new URL(name, root), output);
}
console.log(
  "Default hero and technology inputs and derivative hashes verified",
);
