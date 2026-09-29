import test from "node:test";
import assert from "node:assert/strict";
import { categoryDescription, seoText } from "../lib/server/seo-text";
import robots from "../app/robots";
import { GET } from "../app/feed/google-merchant.xml/route";

test("SEO descriptions are plain text with decoded entities and a bounded first sentence", () => {
  assert.equal(
    seoText(
      "<p>Oil &amp; filter</p><p>5W30&nbsp; &#8212; test</p><script>hidden()</script>",
    ),
    "Oil & filter 5W30 — test",
  );
  assert.equal(
    categoryDescription(
      "Oleje",
      "<p>Pierwsze zdanie.</p><p>Drugie zdanie.</p>",
    ),
    "Pierwsze zdanie.",
  );
  assert.equal(categoryDescription("Oleje", "a".repeat(200)).length, 155);
  assert.equal(
    categoryDescription("Oleje", "<p> </p>"),
    "Oleje Royal Purple — oryginalne oleje z importu, ceny brutto, wysyłka z Kielc. INNOCHEM, dystrybutor od 2009 roku.",
  );
});

test("robots permits catalog filters in production and preview feed fails closed without a database", async () => {
  const oldPreview = process.env.STOREFRONT_PREVIEW;
  const oldUrl = process.env.APP_URL;
  try {
    process.env.STOREFRONT_PREVIEW = "false";
    process.env.APP_URL = "https://merchant.example.test";
    assert.deepEqual(robots(), {
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/konto", "/zamowienie", "/api", "/odstapienie"],
      },
      sitemap: "https://merchant.example.test/sitemap.xml",
    });
    delete process.env.STOREFRONT_PREVIEW;
    assert.deepEqual(robots(), { rules: { userAgent: "*", disallow: "/" } });
    const response = await GET();
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("x-robots-tag"), "noindex");
  } finally {
    if (oldPreview === undefined) delete process.env.STOREFRONT_PREVIEW;
    else process.env.STOREFRONT_PREVIEW = oldPreview;
    if (oldUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldUrl;
  }
});
