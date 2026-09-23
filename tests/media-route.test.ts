import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { query, database } from "../lib/server/db";
import { GET } from "../app/media/[...path]/route";
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
  }
});
test("media paths cannot escape the root or use an external redirect destination", async () => {
  const old = process.env.MEDIA_ROOT;
  process.env.MEDIA_ROOT = await mkdtemp(
    path.join(os.tmpdir(), "innochem-media-boundary-"),
  );
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
  }
});
