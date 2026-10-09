import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { query, database } from "../lib/server/db";
import { GET } from "../app/media/[...path]/route";
import { derivativeFormat } from "../lib/server/media-format";
if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error("Dedicated test database required");
after(async () => database().end());
test("historical encoded media aliases lead to a real file and preserve its bytes", async () => {
  const old = process.env.MEDIA_ROOT;
  const root = await mkdtemp(path.join(os.tmpdir(), "innochem-media-test-"));
  process.env.MEDIA_ROOT = root;
  try {
    await mkdir(path.join(root, "legacy"));
    const bytes = Buffer.from("Synthetic route integrity fixture");
    await writeFile(path.join(root, "legacy", "image+-name.jpg"), bytes);
    await query(
      "INSERT INTO redirects(source_path,destination_path,status) VALUES('/media/legacy/imagę-name.jpg','/media/legacy/image%2B-name.jpg',301)",
    );
    const first = await GET(
      new Request("http://localhost/media/legacy/imag%C4%99-name.jpg"),
      { params: Promise.resolve({ path: ["legacy", "imagę-name.jpg"] }) },
    );
    assert.equal(first.status, 301);
    assert.equal(
      first.headers.get("location"),
      "http://localhost/media/legacy/image%2B-name.jpg",
    );
    const file = await GET(new Request(first.headers.get("location")!), {
      params: Promise.resolve({ path: ["legacy", "image+-name.jpg"] }),
    });
    assert.equal(file.status, 200);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
    assert.equal(file.headers.get("x-content-type-options"), "nosniff");
  } finally {
    process.env.MEDIA_ROOT = old;
    await rm(root, { recursive: true });
  }
});
test("media paths cannot escape the root or use an external redirect destination", async () => {
  const old = process.env.MEDIA_ROOT;
  const root = await mkdtemp(
    path.join(os.tmpdir(), "innochem-media-boundary-"),
  );
  process.env.MEDIA_ROOT = root;
  try {
    await query(
      "INSERT INTO redirects(source_path,destination_path,status) VALUES('/media/unsafe.jpg','//external.example/image.jpg',301)",
    );
    assert.equal(
      (
        await GET(new Request("http://localhost/media/unsafe.jpg"), {
          params: Promise.resolve({ path: ["unsafe.jpg"] }),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await GET(new Request("http://localhost/media/no-file.jpg"), {
          params: Promise.resolve({ path: ["..", "no-file.jpg"] }),
        })
      ).status,
      404,
    );
  } finally {
    process.env.MEDIA_ROOT = old;
    await rm(root, { recursive: true });
  }
});
test("resized derivatives are WebP, cached on disk and never larger than requested", async () => {
  const sharp = (await import("sharp")).default;
  const old = process.env.MEDIA_ROOT;
  const root = await mkdtemp(path.join(os.tmpdir(), "innochem-media-resize-"));
  process.env.MEDIA_ROOT = root;
  try {
    await writeFile(
      path.join(root, "bottle.png"),
      await sharp({
        create: {
          width: 1200,
          height: 1600,
          channels: 4,
          background: "#4c2fd6",
        },
      })
        .png()
        .toBuffer(),
    );
    const call = (url: string) =>
      GET(new Request(url), {
        params: Promise.resolve({ path: ["bottle.png"] }),
      });
    const first = await call("http://localhost/media/bottle.png?w=480");
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("content-type"), "image/webp");
    const bytes = Buffer.from(await first.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, 480);
    assert.equal(meta.height, 640);
    const second = await call("http://localhost/media/bottle.png?w=480");
    assert.deepEqual(Buffer.from(await second.arrayBuffer()), bytes);
    assert.equal(
      (await call("http://localhost/media/bottle.png?w=999")).status,
      404,
    );
    const original = await call("http://localhost/media/bottle.png");
    assert.equal(original.headers.get("content-type"), "image/png");
    assert.equal(
      (
        await GET(new Request("http://localhost/media/_derivatives/x.webp"), {
          params: Promise.resolve({ path: ["_derivatives", "x.webp"] }),
        })
      ).status,
      404,
    );
  } finally {
    process.env.MEDIA_ROOT = old;
    await rm(root, { recursive: true });
  }
});

test("AVIF negotiation respects explicit exclusions and relative preferences", () => {
  assert.equal(derivativeFormat(null), "webp");
  assert.equal(derivativeFormat("image/*,*/*"), "webp");
  assert.equal(derivativeFormat("image/avif,image/webp,*/*;q=0.8"), "avif");
  assert.equal(derivativeFormat("IMAGE/AVIF; q=0.9,image/webp;q=0.8"), "avif");
  assert.equal(derivativeFormat("image/avif;q=0,image/webp"), "webp");
  assert.equal(derivativeFormat("image/avif;q=0.5,image/webp"), "webp");
  assert.equal(derivativeFormat("image/avif;q=invalid"), "webp");
});

test("AVIF and WebP caches and validators stay separate, with original pixels untouched", async () => {
  const sharp = (await import("sharp")).default;
  const old = process.env.MEDIA_ROOT;
  const root = await mkdtemp(path.join(os.tmpdir(), "innochem-media-avif-"));
  process.env.MEDIA_ROOT = root;
  try {
    const source = await sharp({
      create: { width: 640, height: 960, channels: 4, background: "#4c2fd688" },
    })
      .png()
      .toBuffer();
    await writeFile(path.join(root, "bottle.png"), source);
    const call = (accept: string, etag?: string) =>
      GET(
        new Request("http://localhost/media/bottle.png?w=320", {
          headers: { accept, ...(etag ? { "if-none-match": etag } : {}) },
        }),
        { params: Promise.resolve({ path: ["bottle.png"] }) },
      );
    const webp = await call("image/webp");
    const avif = await call("image/avif,image/webp");
    assert.equal(avif.status, 200);
    assert.equal(avif.headers.get("content-type"), "image/avif");
    assert.equal(avif.headers.get("vary"), "Accept");
    assert.notEqual(avif.headers.get("etag"), webp.headers.get("etag"));
    const bytes = Buffer.from(await avif.arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.compression, "av1");
    assert.equal(metadata.width, 320);
    assert.equal(metadata.height, 480);
    assert.equal(metadata.hasAlpha, true);
    const cached = await call("image/avif,image/webp");
    assert.deepEqual(Buffer.from(await cached.arrayBuffer()), bytes);
    assert.equal(
      (await call("image/avif,image/webp", avif.headers.get("etag")!)).status,
      304,
    );
    const other = await call(
      "image/avif,image/webp",
      webp.headers.get("etag")!,
    );
    assert.equal(other.status, 200);
    assert.equal(other.headers.get("content-type"), "image/avif");
    assert.deepEqual(await readFile(path.join(root, "bottle.png")), source);
  } finally {
    process.env.MEDIA_ROOT = old;
    await rm(root, { recursive: true });
  }
});
