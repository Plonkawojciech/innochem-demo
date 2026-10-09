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
const outputName = "hero-olej-mobile-855b096a504ba167.avif";
const outputHash =
  "855b096a504ba167cd63d977fb299ead3487467df0d96315de2251218468ed58";
if (process.argv.includes("--check")) {
  if (hash(await readFile(new URL(outputName, root))) !== outputHash)
    throw new Error("Mobile hero does not match its immutable asset name");
  console.log("Default hero input and mobile asset hashes verified");
  process.exit(0);
}
// At widths <=800px the hero is taller than its width: this preserves all
// source pixels exposed by the existing centred object-fit:cover composition.
const output = await sharp(source)
  .extract({ left: 288, top: 0, width: 960, height: 1024 })
  .avif({ quality: 55, effort: 4 })
  .toBuffer();
if (hash(output) !== outputHash)
  throw new Error("Encoder output changed; review and update the asset hash");
await writeFile(new URL(outputName, root), output);
console.log("Mobile hero: 24026 bytes; original retained");
