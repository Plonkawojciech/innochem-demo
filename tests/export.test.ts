import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { hashPassword } from "better-auth/crypto";
import { auth } from "../lib/server/auth";
import { database, query } from "../lib/server/db";
import { publicExportData } from "../lib/server/export-data";
import { GET, HEAD } from "../app/api/admin/export/route";
if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error("Dedicated test database required");
after(async () => database().end());
// Separate this suite's synthetic proxy client from other suites' anonymous
// per-path login bucket; keep the real authentication rate limit enabled.
process.env.TRUST_PROXY = "true";
const origin = process.env.APP_URL!;
async function admin() {
  const id = randomUUID(),
    email = `export-${id}@example.test`;
  const password = "Synthetic-export-only-2026";
  await query(
    "INSERT INTO auth_user(id,name,email,\"emailVerified\",role) VALUES($1,'Synthetic export',$2,true,'admin')",
    [id, email],
  );
  await query(
    'INSERT INTO auth_account("accountId","providerId","userId",password,"updatedAt") VALUES($1::text,\'credential\',$1::uuid,$2,now())',
    [id, await hashPassword(password)],
  );
  const response = await auth().handler(
    new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        origin,
        "Content-Type": "application/json",
        "x-real-ip": "192.0.2.30",
      },
      body: JSON.stringify({ email, password }),
    }),
  );
  assert.equal(response.status, 200);
  const headers = new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
    origin,
  });
  return { id, headers };
}
test("exports preserve business data while removing nested authentication and deduplication keys", () => {
  const at = new Date("2026-10-08T12:00:00Z");
  assert.deepEqual(
    publicExportData({
      created_at: at,
      source_data: {
        passwd: "hash",
        secure_key: "key",
        lines: [{ sku: "SKU", quantity: 2, token: "private" }],
      },
      data: { idempotencyKey: "private", phone: "123456789" },
      request: { success_url: "secret" },
      provider_order_id: "operator-42",
    }),
    {
      created_at: at,
      source_data: { lines: [{ sku: "SKU", quantity: 2 }] },
      data: { phone: "123456789" },
      provider_order_id: "operator-42",
    },
  );
});
test("JSON includes shipments and consent evidence; order CSV includes address and items", async () => {
  const { headers, id } = await admin();
  const order = (
    await query(
      "INSERT INTO orders(email,buyer,shipping_address,status,payment_method,subtotal_cents,shipping_cents,total_cents,shipping_method,shipping_label,stock_committed,terms_version,source_data) VALUES('export-buyer@example.test',$1,$2,'processing','cod',8000,2800,10800,'courier','Courier',true,'test',$3) RETURNING id",
      [
        JSON.stringify({
          firstName: "=FORMULA",
          lastName: "Tester",
          phone: "123456789",
          company: "Synthetic",
          nip: "1234567890",
        }),
        JSON.stringify({
          street: "Synthetic 1",
          postalCode: "00-001",
          city: "Test",
          country: "PL",
        }),
        JSON.stringify({
          passwd: "MUST-NOT-EXPORT",
          nested: { accessToken: "MUST-NOT-EXPORT" },
        }),
      ],
    )
  ).rows[0];
  await query(
    "INSERT INTO order_items(order_id,product_name,sku,quantity,unit_price_cents,tax_rate,total_cents) VALUES($1,'Synthetic bottle','SYN',1,8000,23,8000)",
    [order.id],
  );
  await query(
    "INSERT INTO shipments(order_id,provider_order_id,service_id,service_name,parcel,cod_cents,created_by,mode) VALUES($1,$2,'1','Synthetic courier','{\"weight\":6}',10800,$3,'sandbox')",
    [order.id, randomUUID(), id],
  );
  const json = await GET(
    new Request(`${origin}/api/admin/export?format=json`, { headers }),
  );
  assert.equal(json.status, 200);
  assert.equal(json.headers.get("Cache-Control"), "private, no-store");
  const data = await json.json();
  assert.equal(data.formatVersion, 2);
  assert(
    data.shipments.some((s: { order_id: string }) => s.order_id === order.id),
  );
  assert(Array.isArray(data.audit_log));
  assert(Array.isArray(data.analytics_consents));
  assert(!("auth_user" in data));
  assert(!JSON.stringify(data).includes("MUST-NOT-EXPORT"));
  const csv = await GET(
    new Request(`${origin}/api/admin/export?format=orders`, { headers }),
  );
  assert.equal(csv.status, 200);
  const text = await csv.text();
  for (const expected of [
    "first_name",
    "postal_code",
    "items",
    "cod_cents",
    "Synthetic 1",
    "SYN — Synthetic bottle × 1",
    "10800",
    "'\u003dFORMULA",
  ])
    assert(text.includes(expected), expected);
});
test("HEAD and already aborted media downloads do not start an archive; originals exclude caches", async () => {
  const { headers, id } = await admin();
  const root = await mkdtemp(path.join(tmpdir(), "innochem-export-"));
  const previous = process.env.MEDIA_ROOT;
  process.env.MEDIA_ROOT = root;
  try {
    await mkdir(path.join(root, "_derivatives"));
    await writeFile(path.join(root, "original.pdf"), "SYNTHETIC-ORIGINAL");
    await writeFile(path.join(root, "upload.tmp"), "INCOMPLETE-UPLOAD");
    await writeFile(
      path.join(root, "_derivatives", "cache.webp"),
      "CACHE-EXCLUDED",
    );
    const head = await HEAD(
      new Request(`${origin}/api/admin/export?format=media`, {
        method: "HEAD",
        headers,
      }),
    );
    assert.equal(head.status, 405);
    assert.equal(head.headers.get("Allow"), "GET");
    const controller = new AbortController();
    controller.abort();
    const cancelled = await GET(
      new Request(`${origin}/api/admin/export?format=media`, {
        headers,
        signal: controller.signal,
      }),
    );
    assert.equal(cancelled.status, 499);
    assert.equal(
      (
        await query(
          "SELECT count(*)::int n FROM audit_log WHERE actor_id=$1 AND action='export.media'",
          [id],
        )
      ).rows[0].n,
      0,
    );
    const archive = await GET(
      new Request(`${origin}/api/admin/export?format=media`, { headers }),
    );
    assert.equal(archive.status, 200);
    const tar = gunzipSync(Buffer.from(await archive.arrayBuffer())).toString();
    assert(tar.includes("original.pdf"));
    assert(tar.includes("SYNTHETIC-ORIGINAL"));
    assert(!tar.includes("_derivatives"));
    assert(!tar.includes("CACHE-EXCLUDED"));
    assert(!tar.includes("INCOMPLETE-UPLOAD"));
    assert.equal(
      (
        await query(
          "SELECT count(*)::int n FROM audit_log WHERE actor_id=$1 AND action='export.media'",
          [id],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    if (previous === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
