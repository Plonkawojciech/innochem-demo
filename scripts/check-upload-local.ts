import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
async function main() {
  if (
    !process.env.PGDATABASE?.startsWith("innochem_test_") ||
    new URL(process.env.APP_URL!).hostname !== "127.0.0.1"
  )
    throw new Error("Synthetic local environment required");
  const base = process.env.APP_URL!,
    origin = new URL(base).origin;
  const response = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "acceptance-admin@example.test",
      password: "Synthetic-only-acceptance-2026",
    }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const image = await readFile("/tmp/innochem-synthetic-upload.png");
  const uploaded = await fetch(`${base}/api/admin/upload`, {
    method: "POST",
    headers: { origin, cookie, "Content-Type": "application/octet-stream" },
    body: image,
  });
  assert.equal(uploaded.status, 201);
  const media = await uploaded.json();
  assert.equal(media.mime_type, "image/png");
  const fetched = await fetch(new URL(media.path, base));
  assert.equal(fetched.status, 200);
  assert.equal(fetched.headers.get("content-type"), "image/png");
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  assert.equal(sha(Buffer.from(await fetched.arrayBuffer())), sha(image));
  const invalid = await fetch(`${base}/api/admin/upload`, {
    method: "POST",
    headers: { origin, cookie, "Content-Type": "image/png" },
    body: "<script>invalid</script>",
  });
  assert.equal(invalid.status, 400);
  console.log(
    "Authenticated upload, byte-for-byte download and invalid-file rejection passed.",
  );
}
main();
