import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { database, query } from "../lib/server/db";
import {
  saveProduct,
  saveCategory,
  savePage,
  saveSettings,
  adminProduct,
} from "../lib/server/admin";
import { actOnOrder } from "../lib/server/admin-orders";
import { StoreError } from "../lib/server/orders";
import { validateUpload } from "../lib/server/uploads";
import { settingsSchema } from "../lib/server/settings";
if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error("Dedicated test database required");
after(async () => database().end());
const actor = "test-admin";
const input = () => ({
  name: "Test product",
  slug: randomUUID(),
  sku: "TEST",
  summary: "",
  descriptionHtml: "<p>Safe</p>",
  priceCents: 8000,
  taxRate: 23,
  stock: 10,
  status: "draft",
  saleMode: "retail",
  weightGrams: 1000,
  metaTitle: "",
  metaDescription: "",
  categoryIds: [],
  mediaIds: [],
  imageAlt: "",
});
const isError = (code: string) => (e: unknown) =>
  e instanceof StoreError && e.code === code;
test("concurrent edits preserve the winning version and log stock and price changes", async () => {
  const p = input(),
    saved = await saveProduct(p, actor);
  const edits = await Promise.allSettled([
    saveProduct({ ...p, version: 1, stock: 12 }, actor, saved.id),
    saveProduct({ ...p, version: 1, priceCents: 9000 }, actor, saved.id),
  ]);
  assert.equal(edits.filter((e) => e.status === "fulfilled").length, 1);
  assert.equal(
    (edits.find((e) => e.status === "rejected") as PromiseRejectedResult).reason
      .code,
    "VERSION_CONFLICT",
  );
  const product = await adminProduct(saved.id);
  assert.equal(product?.version, 2);
  assert.equal(
    (
      await query("SELECT count(*)::int n FROM audit_log WHERE entity_id=$1", [
        saved.id,
      ])
    ).rows[0].n,
    2,
  );
});
test("stock adjustment cannot consume a buyer's reservation", async () => {
  const p = input(),
    saved = await saveProduct(p, actor);
  await query("UPDATE products SET reserved=8 WHERE id=$1", [saved.id]);
  await assert.rejects(
    saveProduct({ ...p, version: 1, stock: 7 }, actor, saved.id),
    isError("RESERVED_STOCK"),
  );
  assert.equal((await adminProduct(saved.id))?.stock, 10);
});
test("invalid media or categories roll back all product changes", async () => {
  const p = input(),
    saved = await saveProduct(p, actor);
  await assert.rejects(
    saveProduct(
      { ...p, version: 1, stock: 99, categoryIds: [randomUUID()] },
      actor,
      saved.id,
    ),
    isError("CATEGORY_MISSING"),
  );
  await assert.rejects(
    saveProduct(
      { ...p, version: 1, stock: 99, mediaIds: [randomUUID()] },
      actor,
      saved.id,
    ),
    isError("MEDIA_INVALID"),
  );
  assert.equal((await adminProduct(saved.id))?.stock, 10);
});
test("HTML is sanitized and archived products keep their order references", async () => {
  const p = input(),
    saved = await saveProduct(
      {
        ...p,
        descriptionHtml:
          '<p onclick="alert(1)">Oil</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>',
      },
      actor,
    );
  const product = await adminProduct(saved.id);
  assert(!product?.description_html.includes("script"));
  assert(!product?.description_html.includes("onclick"));
  await saveProduct({ ...p, version: 1, status: "archived" }, actor, saved.id);
  assert.equal((await adminProduct(saved.id))?.status, "archived");
});
test("category topology prevents cycles, including concurrent parent edits", async () => {
  const value = {
    name: "Category",
    slug: randomUUID(),
    parentId: null,
    descriptionHtml: "",
    visible: true,
    position: 0,
  };
  const a = await saveCategory(value, actor),
    b = await saveCategory({ ...value, slug: randomUUID() }, actor);
  const result = await Promise.allSettled([
    saveCategory({ ...value, version: 1, parentId: b.id }, actor, a.id),
    saveCategory(
      { ...value, slug: randomUUID(), version: 1, parentId: a.id },
      actor,
      b.id,
    ),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (result.find((r) => r.status === "rejected") as PromiseRejectedResult)
      .reason.code,
    "CATEGORY_CYCLE",
  );
});
test("publishing a page does not approve checkout terms", async () => {
  const before = (await query("SELECT value FROM settings WHERE key='store'"))
    .rows[0].value;
  await savePage(
    {
      slug: randomUUID(),
      title: "Test page",
      bodyHtml: "<p>Terms</p>",
      metaDescription: "",
      published: true,
    },
    actor,
  );
  assert.deepEqual(
    (await query("SELECT value FROM settings WHERE key='store'")).rows[0].value,
    before,
  );
});
test("settings reject stale versions and duplicate delivery identifiers", async () => {
  const {
    rows: [row],
  } = await query("SELECT value,version FROM settings WHERE key='store'");
  const value = settingsSchema.parse(row.value);
  await saveSettings({ value, version: row.version }, actor);
  await assert.rejects(
    saveSettings({ value, version: row.version }, actor),
    isError("VERSION_CONFLICT"),
  );
  const shipping = {
    id: "test",
    label: "Test",
    priceCents: 1,
    cod: false,
    enabled: false,
    maxWeightGrams: 0,
  };
  await assert.rejects(
    saveSettings(
      {
        version: row.version + 1,
        value: { ...value, shippingMethods: [shipping, shipping] },
      },
      actor,
    ),
    isError("SHIPPING_DUPLICATE"),
  );
});
test("uploads validate actual image bytes and reject SVG or disguised HTML", async () => {
  await assert.rejects(
    validateUpload(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    ),
    isError("FILE_FORMAT"),
  );
  await assert.rejects(
    validateUpload(Buffer.from("<html>not a jpg</html>")),
    isError("FILE_FORMAT"),
  );
  await assert.rejects(
    validateUpload(Buffer.alloc(15 * 1024 * 1024 + 1)),
    isError("FILE_SIZE"),
  );
  const png = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  assert.deepEqual(await validateUpload(png), {
    extension: "png",
    mime: "image/png",
  });
});
async function orderFixture(method = "cod", status = "processing") {
  const saved = await saveProduct(input(), actor);
  const {
    rows: [o],
  } = await query(
    "INSERT INTO orders(email,buyer,shipping_address,status,payment_method,subtotal_cents,shipping_cents,total_cents,shipping_method,shipping_label,stock_committed,terms_version) VALUES('synthetic@example.test','{}','{}',$1,$2,8000,0,8000,'test','Test',true,'test') RETURNING id",
    [status, method],
  );
  await query(
    "INSERT INTO order_items(order_id,product_id,product_name,sku,quantity,unit_price_cents,tax_rate,total_cents) VALUES($1,$2,'Test','TEST',1,8000,23,8000)",
    [o.id, saved.id],
  );
  return { id: o.id, product: saved.id };
}
test("cash-on-delivery cancellation restocks once under concurrent retries", async () => {
  const o = await orderFixture(),
    action = {
      action: "cancel_cod",
      expectedStatus: "processing",
      idempotencyKey: randomUUID(),
    };
  const results = await Promise.all([
    actOnOrder(o.id, action, actor),
    actOnOrder(o.id, action, actor),
  ]);
  assert.equal(results.filter((r) => r.replayed).length, 1);
  assert.equal((await adminProduct(o.product))?.stock, 11);
  await assert.rejects(
    actOnOrder(o.id, { ...action, note: "Changed payload" }, actor),
    isError("IDEMPOTENCY_CONFLICT"),
  );
});
test("shipment transition rejects stale status and queues one notification", async () => {
  const o = await orderFixture(),
    action = {
      action: "ship",
      expectedStatus: "processing",
      trackingNumber: "SYNTHETIC",
      idempotencyKey: randomUUID(),
    };
  await actOnOrder(o.id, action, actor);
  await actOnOrder(o.id, action, actor);
  await assert.rejects(
    actOnOrder(o.id, { ...action, idempotencyKey: randomUUID() }, actor),
    isError("VERSION_CONFLICT"),
  );
  assert.equal(
    (
      await query(
        "SELECT count(*)::int n FROM mail_outbox WHERE event_key=$1",
        [`order:${o.id}:shipped`],
      )
    ).rows[0].n,
    1,
  );
});
test("refund accounting requires proof and must not refund the same stock twice", async () => {
  const o = await orderFixture("bank_transfer", "paid"),
    action = {
      action: "record_refund",
      expectedStatus: "paid",
      idempotencyKey: randomUUID(),
      amountCents: 8000,
      reference: "SYNTHETIC-REFUND",
      note: "Synthetic completed refund",
      restock: true,
    };
  await assert.rejects(
    actOnOrder(o.id, { ...action, amountCents: 1 }, actor),
    isError("REFUND_PROOF_REQUIRED"),
  );
  await actOnOrder(o.id, action, actor);
  await actOnOrder(o.id, action, actor);
  assert.equal((await adminProduct(o.product))?.stock, 11);
});
test("manual bank confirmation cannot apply to a different payment method", async () => {
  const o = await orderFixture("p24", "pending_payment");
  await assert.rejects(
    actOnOrder(
      o.id,
      {
        action: "confirm_bank",
        expectedStatus: "pending_payment",
        idempotencyKey: randomUUID(),
        reference: "test",
        amountCents: 8000,
      },
      actor,
    ),
    isError("PAYMENT_METHOD_MISMATCH"),
  );
});

test("CMS page and category renames preserve links, including restoring a previous slug", async () => {
  const { resolveRedirect } = await import("../lib/server/redirects");
  const key = randomUUID();
  const data = {
    name: "Synthetic rename",
    slug: `rename-${key}`,
    parentId: null,
    descriptionHtml: "",
    visible: true,
    position: 0,
  };
  const a = await saveCategory(data, "synthetic");
  const b = await saveCategory(
    { ...data, slug: `renamed-${key}`, version: a.version },
    "synthetic",
    a.id,
  );
  assert.equal(
    (
      await resolveRedirect(
        new URL(`https://test.local/kategoria/${data.slug}`),
      )
    )?.destination,
    `/kategoria/renamed-${key}`,
  );
  await saveCategory({ ...data, version: b.version }, "synthetic", a.id);
  assert.equal(
    await resolveRedirect(new URL(`https://test.local/kategoria/${data.slug}`)),
    null,
  );
  assert.equal(
    (
      await resolveRedirect(
        new URL(`https://test.local/kategoria/renamed-${key}`),
      )
    )?.destination,
    `/kategoria/${data.slug}`,
  );
  const page = {
    slug: `page-${key}`,
    title: "Synthetic page",
    bodyHtml: "<p>Test</p>",
    metaDescription: "",
    published: true,
  };
  const p = await savePage(page, "synthetic");
  await savePage(
    { ...page, slug: `new-page-${key}`, version: p.version },
    "synthetic",
    p.id,
  );
  assert.equal(
    (await resolveRedirect(new URL(`https://test.local/${page.slug}`)))
      ?.destination,
    `/new-page-${key}`,
  );
  await assert.rejects(
    savePage({ ...page, slug: "konto" }, "synthetic"),
    (e) => e instanceof StoreError && e.code === "RESERVED_SLUG",
  );
});

test("technical documents can be shared, edited and detached without deleting source files", async () => {
  const document = (
    await query(
      "INSERT INTO media(source_system,source_id,source_path,path,mime_type,size_bytes,sha256) VALUES('test',$1,'synthetic.pdf',$2,'application/pdf',10,$3) RETURNING id",
      [randomUUID(), `/media/${randomUUID()}.pdf`, "0".repeat(64)],
    )
  ).rows[0];
  const a = input(),
    b = input();
  const attachment = {
    mediaId: document.id,
    label: "Synthetic data sheet",
    archival: true,
  };
  const one = await saveProduct({ ...a, documents: [attachment] }, actor),
    two = await saveProduct({ ...b, documents: [attachment] }, actor);
  assert.equal((await adminProduct(one.id))?.documents[0].archival, true);
  await saveProduct(
    { ...a, version: one.version, documents: [] },
    actor,
    one.id,
  );
  assert.equal((await adminProduct(one.id))?.documents.length, 0);
  assert.equal((await adminProduct(two.id))?.documents.length, 1);
  assert.equal(
    (
      await query("SELECT count(*)::int n FROM media WHERE id=$1", [
        document.id,
      ])
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    saveProduct(
      {
        ...b,
        version: two.version,
        documents: [{ ...attachment, mediaId: randomUUID() }],
      },
      actor,
      two.id,
    ),
    isError("DOCUMENT_INVALID"),
  );
  const image = (
    await query(
      "INSERT INTO media(source_system,source_id,source_path,path,mime_type,size_bytes,sha256) VALUES('test',$1,'synthetic.png',$2,'image/png',10,$3) RETURNING id",
      [randomUUID(), `/media/${randomUUID()}.png`, "0".repeat(64)],
    )
  ).rows[0];
  await assert.rejects(
    saveProduct(
      {
        ...b,
        version: two.version,
        documents: [{ ...attachment, mediaId: image.id }],
      },
      actor,
      two.id,
    ),
    isError("DOCUMENT_INVALID"),
  );
  assert.equal((await adminProduct(two.id))?.version, two.version);
});
