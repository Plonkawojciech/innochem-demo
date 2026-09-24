import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { resolveRedirect } from "@/lib/server/redirects";
import { mediaWidths, type MediaWidth } from "@/lib/media";
export const runtime = "nodejs";
const types: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".odt": "application/vnd.oasis.opendocument.text",
};
const resizable = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"]);
const cacheDir = "_derivatives";
const derivativeInFlight = new Map<string, Promise<Buffer>>();

/** Resized WebP derivatives are cached next to the originals and keyed by source size and mtime. */
async function derivative(
  base: string,
  file: string,
  info: { size: number; mtimeMs: number },
  width: MediaWidth,
) {
  const key = createHash("sha1")
    .update(`${file}:${info.size}:${Math.floor(info.mtimeMs)}:${width}`)
    .digest("hex");
  const target = path.join(base, cacheDir, key.slice(0, 2), `${key}.webp`);
  try {
    return await readFile(target);
  } catch {
    /* not cached yet */
  }
  const pending = derivativeInFlight.get(target);
  if (pending) return pending;
  const work = (async () => {
    const image = sharp(file, { limitInputPixels: 40000000, animated: false });
    const meta = await image.metadata();
    const buffer = await image
      .rotate()
      .resize({ width, withoutEnlargement: true, fit: "inside" })
      .webp({ quality: 82, effort: 4, alphaQuality: 90 })
      .toBuffer();
    if (!meta.width) throw new Error("Unreadable image");
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, buffer);
    await rename(temporary, target);
    return buffer;
  })();
  derivativeInFlight.set(target, work);
  try {
    return await work;
  } finally {
    derivativeInFlight.delete(target);
  }
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const root = process.env.MEDIA_ROOT;
  if (!root) return new Response("Not available", { status: 503 });
  const parts = (await params).path;
  if (
    parts.some(
      (p) => p === "." || p === ".." || p.includes("\\") || p.includes("\0"),
    ) ||
    parts[0] === cacheDir
  )
    return new Response("Not found", { status: 404 });
  const extension = path.extname(parts.join("/")).toLowerCase();
  const mime = types[extension];
  if (!mime) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const requestedWidth = Number(url.searchParams.get("w"));
  const width = (mediaWidths as readonly number[]).includes(requestedWidth)
    ? (requestedWidth as MediaWidth)
    : null;
  if (url.searchParams.has("w") && (!width || !resizable.has(extension)))
    return new Response("Not found", { status: 404 });
  try {
    const base = await realpath(root);
    const file = await realpath(path.resolve(base, ...parts));
    if (!file.startsWith(base + path.sep))
      return new Response("Not found", { status: 404 });
    const info = await stat(file);
    if (!info.isFile() || info.size > 25 * 1024 * 1024)
      return new Response("Not found", { status: 404 });
    const etag = `"${info.size}-${Math.floor(info.mtimeMs)}${width ? `-w${width}` : ""}"`;
    const headers: Record<string, string> = {
      "Content-Type": width ? "image/webp" : mime,
      "Cache-Control": width
        ? "public, max-age=604800, stale-while-revalidate=86400"
        : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      Vary: "Accept",
      ETag: etag,
      ...(/\.(?:docx?|odt)$/i.test(file)
        ? {
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
          }
        : {}),
    };
    if (request.headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers });
    const body = width
      ? await derivative(base, file, info, width)
      : await readFile(file);
    return new Response(new Uint8Array(body), {
      headers: { ...headers, "Content-Length": String(body.length) },
    });
  } catch {
    const alias = await resolveRedirect(new URL(request.url));
    if (alias?.destination?.startsWith("/media/"))
      return Response.redirect(new URL(alias.destination, request.url), 301);
    return new Response("Not found", { status: 404 });
  }
}
