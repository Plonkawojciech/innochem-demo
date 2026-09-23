import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { query, database } from "../lib/server/db";
import { products, cartProducts } from "../lib/server/catalog";
import { POST } from "../app/api/cart/route";
if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error("Dedicated test database required");
after(async () => database().end());
test("catalog and cart retain products beyond the former 500-product cap without serializing the whole store", async () => {
  const prefix = randomUUID();
  const cat = (
    await query(
      "INSERT INTO categories(slug,name) VALUES($1,'Synthetic large catalog') RETURNING id",
      [prefix],
    )
  ).rows[0];
  const rows = (
    await query(
      "INSERT INTO products(slug,name,price_cents,stock,status) SELECT $1||'-'||n,$1||'-'||lpad(n::text,3,'0'),8000,4,'active' FROM generate_series(1,501) n RETURNING id,name",
      [prefix],
    )
  ).rows;
  await query(
    "INSERT INTO product_categories(product_id,category_id) SELECT id,$1 FROM products WHERE slug LIKE $2",
    [cat.id, prefix + "%"],
  );
  const first = await products({ category: prefix }),
    last = await products({ category: prefix, page: 21 });
  assert.equal(first.total, 501);
  assert.equal(first.items.length, 24);
  assert.equal(last.items.length, 21);
  assert.ok(last.items.some((p) => p.name === prefix + "-501"));
  const target = rows.find((r) => r.name === prefix + "-501")!;
  assert.equal((await cartProducts([target.id]))[0].name, target.name);
  await query("UPDATE products SET status='archived' WHERE id=$1", [target.id]);
  assert.deepEqual(await cartProducts([target.id]), []);
  const origin = process.env.APP_URL!;
  const request = (ids: string[]) =>
    new Request(`${origin}/api/cart`, {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  assert.equal(
    (await POST(request(Array.from({ length: 51 }, () => randomUUID()))))
      .status,
    400,
  );
  assert.equal((await POST(request(["bad-id"]))).status, 400);
  assert.equal(
    (await POST(request([rows[0].id]))).headers.get("cache-control"),
    "no-store",
  );
});
