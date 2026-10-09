import test from "node:test";
import assert from "node:assert/strict";
import { productCardData, type StoreProduct } from "../lib/store-types";
import { item } from "../lib/analytics";
import { addToCart } from "../lib/cart-state";

test("card projection omits descriptions while retaining VAT analytics and the real stock cap", () => {
  const product: StoreProduct = {
    id: "c0f9509a-75c5-4501-99b7-8d15f47a6d32",
    slug: "synthetic-oil",
    name: "Synthetic Oil 5W30",
    sku: "TEST-ONLY",
    summary: "Long product summary",
    descriptionHtml: "<p>Long product description</p>".repeat(100),
    priceCents: 999,
    taxRate: 23,
    available: 3,
    weightGrams: 2000,
    imagePath: "/media/synthetic.png",
    imageAlt: "Synthetic",
    saleMode: "retail",
    categorySlugs: ["synthetic-category"],
    metaTitle: "Synthetic SEO",
    metaDescription: "Synthetic SEO description",
  };
  const before = JSON.stringify(product);
  const card = productCardData(product);
  assert.equal(JSON.stringify(product), before);
  assert.equal("descriptionHtml" in card, false);
  assert.equal("summary" in card, false);
  assert.equal("metaDescription" in card, false);
  assert.deepEqual(item(card, 3), item(product, 3));
  const cart = addToCart({}, card.id, 7, card);
  assert.equal(cart.quantity, 3);
  assert.equal(cart.delta, 3);
  assert.equal(cart.limit, "stock");
  assert.equal(card.imagePath, product.imagePath);
  assert.equal(card.slug, product.slug);
});
