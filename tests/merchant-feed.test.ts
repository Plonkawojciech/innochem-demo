import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database, query } from "../lib/server/db";
import { GET } from "../app/feed/google-merchant.xml/route";
import sitemap from "../app/sitemap";

if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error("Dedicated test database required");
after(async () => database().end());

test("Merchant feed includes the complete active retail catalog and sitemap retains inquiry pages", async () => {
  const oldPreview = process.env.STOREFRONT_PREVIEW;
  const oldUrl = process.env.APP_URL;
  process.env.STOREFRONT_PREVIEW = "false";
  process.env.APP_URL = "https://merchant.example.test";
  try {
    const prefix = randomUUID();
    const { rows } = await query(
      `INSERT INTO products(slug,name,sku,summary,price_cents,stock,reserved,status,sale_mode,image_path)
       SELECT $1||'-'||n,'Royal Purple HPS & test '||n,
       CASE WHEN n=2 THEN '' ELSE $1||'-SKU-'||n END,
       '<p>Oil &amp; protection.</p><p>Second paragraph.</p>',7900,3,
       CASE WHEN n=2 THEN 3 ELSE 0 END,
       CASE WHEN n=28 THEN 'archived' ELSE 'active' END,
       CASE WHEN n=27 THEN 'inquiry' ELSE 'retail' END,
       '/media/test.jpg?source=cover'
       FROM generate_series(1,28) n RETURNING id,slug,sku,updated_at`,
      [prefix],
    );
    const response = await GET();
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("content-type"),
      "application/xml; charset=utf-8",
    );
    assert.equal(response.headers.get("cache-control"), "public, max-age=900");
    const xml = await response.text();
    assert.match(xml, /xmlns:g="http:\/\/base.google.com\/ns\/1.0"/);
    const items = xml.match(/<item>.*?<\/item>/gs) || [];
    for (let n = 1; n <= 26; n++) {
      const row = rows.find((r) => r.slug === `${prefix}-${n}`)!;
      const item = items.find((item) =>
        item.includes(
          `<link>https://merchant.example.test/produkt/${row.slug}</link>`,
        ),
      );
      assert.ok(
        item,
        `retail product ${n} is included beyond one catalog page`,
      );
      assert.ok(item.includes(`<g:id>${row.sku || row.id}</g:id>`));
      assert.ok(
        item.includes(
          `<g:availability>${n === 2 ? "out_of_stock" : "in_stock"}</g:availability>`,
        ),
      );
      assert.ok(item.includes("<g:price>79.00 PLN</g:price>"));
      assert.ok(
        item.includes(
          "<description>Oil &amp; protection. Second paragraph.</description>",
        ),
      );
      assert.ok(
        item.includes(
          "<g:image_link>https://merchant.example.test/media/test.jpg?source=cover&amp;w=960</g:image_link>",
        ),
      );
      assert.ok(
        item.includes(
          "<g:product_type>HPS – High Performance Street</g:product_type>",
        ),
      );
      assert.ok(item.includes(`Royal Purple HPS &amp; test ${n}`));
      assert.equal(item.includes("<g:mpn>"), n !== 2);
    }
    assert.ok(!xml.includes(`${prefix}-27`));
    assert.ok(!xml.includes(`${prefix}-28`));
    assert.ok(!xml.includes("g:identifier_exists"));
    assert.ok(!xml.includes("g:shipping"));

    await query(
      `INSERT INTO pages(slug,title,body_html,published) VALUES
       ($1,'Published','<p>Test</p>',true),
       ($2,'Archive','<p>Test</p>',false),
       ('odstapienie','Withdrawal','<p>Test</p>',true)
       ON CONFLICT(slug) DO NOTHING`,
      [`info-${prefix}`, `archiwum-wp-${prefix}`],
    );
    const map = await sitemap();
    const paths = map.map((entry) => new URL(entry.url).pathname);
    for (const path of [
      "/",
      "/katalog",
      "/przemysl",
      "/kontakt",
      "/dystrybutorzy",
      "/o-firmie",
      `/produkt/${prefix}-27`,
      `/info-${prefix}`,
    ])
      assert.ok(paths.includes(path), path);
    assert.ok(!paths.includes(`/produkt/${prefix}-28`));
    assert.ok(!paths.includes(`/archiwum-wp-${prefix}`));
    assert.ok(!paths.includes("/odstapienie"));
    const item = map.find((entry) =>
      entry.url.endsWith(`/produkt/${prefix}-1`),
    )!;
    assert.equal(
      new Date(item.lastModified!).toISOString(),
      rows.find((r) => r.slug === `${prefix}-1`)!.updated_at.toISOString(),
    );

    process.env.STOREFRONT_PREVIEW = "true";
    const preview = await GET();
    assert.equal(preview.status, 404);
    assert.equal(preview.headers.get("x-robots-tag"), "noindex");
    assert.deepEqual(await sitemap(), []);
  } finally {
    if (oldPreview === undefined) delete process.env.STOREFRONT_PREVIEW;
    else process.env.STOREFRONT_PREVIEW = oldPreview;
    if (oldUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldUrl;
  }
});
