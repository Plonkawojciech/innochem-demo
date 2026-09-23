import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { resolveRedirect } from "@/lib/server/redirects";
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
    )
  )
    return new Response("Not found", { status: 404 });
  const mime = types[path.extname(parts.join("/")).toLowerCase()];
  if (!mime) return new Response("Not found", { status: 404 });
  try {
    const base = await realpath(root);
    const file = await realpath(path.resolve(base, ...parts));
    if (!file.startsWith(base + path.sep))
      return new Response("Not found", { status: 404 });
    const info = await stat(file);
    if (!info.isFile() || info.size > 25 * 1024 * 1024)
      return new Response("Not found", { status: 404 });
    const etag = `"${info.size}-${Math.floor(info.mtimeMs)}"`;
    const headers = {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      ETag: etag,
      ...(/\.(?:docx?|odt)$/i.test(file)
        ? {
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
          }
        : {}),
    };
    if (request.headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(await readFile(file)), {
      headers: { ...headers, "Content-Length": String(info.size) },
    });
  } catch {
    const alias = await resolveRedirect(new URL(request.url));
    if (alias?.destination?.startsWith("/media/"))
      return Response.redirect(new URL(alias.destination, request.url), 301);
    return new Response("Not found", { status: 404 });
  }
}
