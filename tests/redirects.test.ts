import test, { after } from "node:test";
import assert from "node:assert/strict";
import { query, database } from "../lib/server/db";
import {
  redirectKey,
  resolveRedirect,
  safeDestination,
} from "../lib/server/redirects";
if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error("Dedicated test database required");
after(async () => database().end());
const url = (path: string) => new URL(path, "https://innochem.test");
async function rule(from: string, to: string | null) {
  await query(
    "INSERT INTO redirects(source_path,destination_path,status) VALUES($1,$2,$3) ON CONFLICT(source_path) DO UPDATE SET destination_path=excluded.destination_path,status=excluded.status",
    [from, to, to ? 301 : 410],
  );
}
test("WordPress IDs and PrestaShop product IDs remain distinct from tracking or pagination", async () => {
  await rule("/?p=528", "/produkt/xpr");
  await rule("/sklep/product.php?id_product=38", "/produkt/xpr");
  await rule("/sklep/7-oils", "/kategoria/oils");
  assert.deepEqual(
    await resolveRedirect(url("/?utm_source=test&p=528&paged=2")),
    { status: 301, destination: "/produkt/xpr" },
  );
  assert.deepEqual(
    await resolveRedirect(
      url("/sklep/product.php?token=secret&id_product=38&id_lang=6"),
    ),
    { status: 301, destination: "/produkt/xpr" },
  );
  assert.equal(
    (await resolveRedirect(url("/sklep/7-oils?p=2")))?.destination,
    "/kategoria/oils",
  );
  assert.equal((await resolveRedirect(url("/?p=98765432")))?.status, 404);
  assert.equal((await resolveRedirect(url("/?p=528&p=529")))?.status, 404);
  assert.equal((await resolveRedirect(url("/?p=528&cat=4")))?.status, 404);
});
test("removed archives return 410, preserved archives and media use their own targets", async () => {
  await rule("/baza-wiedzy", null);
  await rule("/category/oils", "/kategoria/oils");
  await rule(
    "/wp-content/uploads/tył.jpg",
    "/media/wp-content/uploads/ty%C5%82.jpg",
  );
  assert.deepEqual(await resolveRedirect(url("/baza-wiedzy/page/2/")), {
    status: 410,
    destination: null,
  });
  assert.equal(
    (await resolveRedirect(url("/category/oils/page/3/")))?.destination,
    "/kategoria/oils",
  );
  assert.equal(
    (await resolveRedirect(url("/wp-content/uploads/ty%C5%82.jpg")))
      ?.destination,
    "/media/wp-content/uploads/ty%C5%82.jpg",
  );
  assert.equal(await resolveRedirect(url("/new-unknown-page")), null);
});
test("renamed product chains collapse and redirect cycles or external targets never escape", async () => {
  await rule("/old", "/middle");
  await rule("/middle", "/produkt/new");
  assert.equal(
    (await resolveRedirect(url("/old")))?.destination,
    "/produkt/new",
  );
  await rule("/cycle-one", "/cycle-two");
  await rule("/cycle-two", "/cycle-one");
  assert.equal((await resolveRedirect(url("/cycle-one")))?.status, 404);
  await rule("/unsafe", "//evil.example/path");
  assert.equal((await resolveRedirect(url("/unsafe")))?.status, 404);
  for (const value of [
    "//evil.test",
    "/\\evil.test",
    "/path\r\nlocation:evil",
    "https://evil.test",
  ])
    assert.equal(safeDestination(value), false);
  assert.equal(safeDestination("/media/test.pdf"), true);
  assert.equal(redirectKey(url("/%ZZ")), null);
});
