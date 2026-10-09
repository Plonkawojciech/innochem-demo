import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  stat,
  symlink,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  compareLegacyDelta,
  legacyDeltaHash,
  legacyNetPriceToGrossCents,
  parseLegacyDeltaSnapshot,
  LegacyDeltaInputError,
  normalizeLegacyDeltaSource,
  exportLegacyDeltaTarget,
  legacyWarsawTimestamp,
} from "../lib/legacy-delta";
import {
  reportLegacyDelta,
  legacyDeltaMaxInputBytes,
  normalizeLegacyDeltaFiles,
  legacyDeltaExportEnvironment,
} from "../scripts/report-legacy-delta";

const h = (value: unknown) => legacyDeltaHash(value);
const imported = <T extends object>(legacyId: string | number, fields: T) => ({
  legacyId,
  fields,
});
const uuid = "00000000-0000-4000-8000-000000000001";
const uuid2 = "00000000-0000-4000-8000-000000000002";
function processDiagnostic(result: ReturnType<typeof spawnSync>): string {
  const code = (result.error as { code?: unknown } | undefined)?.code;
  return JSON.stringify({
    status: result.status,
    signal: result.signal,
    errorCode:
      typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? code : null,
  });
}
const legacyRef = (id: number) => ({ legacyId: id });
function source() {
  return {
    schemaVersion: 1,
    role: "source",
    categories: [
      imported(1, {
        slugHash: h("oil"),
        nameHash: h("Oil"),
        descriptionHtmlHash: h(""),
        parentRef: null,
        visible: true,
        position: 0,
      }),
    ],
    products: [
      {
        ...imported(1, {
          slugHash: h("oil-1"),
          skuHash: h("SKU"),
          nameHash: h("Product"),
          summaryHash: h(""),
          descriptionHtmlHash: h(""),
          price: { kind: "net", amount: "10.000000", taxRate: "23.000000" },
          stock: 10,
          status: "active",
          saleMode: "retail",
          weightGrams: 1000,
          imagePathHash: h(null),
          imageAltHash: h("Product"),
          metaTitleHash: h("Product"),
          metaDescriptionHash: h(""),
          categoryRefs: [legacyRef(1)],
        }),
        reserved: 0,
        stockMovementCount: 0,
      },
    ],
    customers: [
      imported(1, {
        emailHash: h("synthetic@example.test"),
        firstNameHash: h("Test"),
        lastNameHash: h("Fixture"),
        sourceCreatedAtHash: h(null),
      }),
    ],
    addresses: [
      imported(1, {
        customerRef: legacyRef(1),
        labelHash: h("synthetic"),
        dataHash: h({ city: "Fixture City", street: "Synthetic 123" }),
        archived: false,
      }),
    ],
    orders: [
      {
        ...imported(1, {
          customerRef: legacyRef(1),
          emailHash: h("synthetic@example.test"),
          buyerHash: h({ name: "Fixture" }),
          shippingAddressHash: h({ street: "Synthetic 123" }),
          status: "legacy",
          paymentMethodHash: h("Legacy transfer"),
          currency: "PLN",
          subtotalCents: 1230,
          shippingCents: 200,
          totalCents: 1430,
          shippingMethodHash: h("legacy-1"),
          shippingLabelHash: h("Carrier"),
          trackingNumberHash: h(null),
          stockCommitted: true,
          termsVersionHash: h("legacy"),
          sourceDataHash: h({ original: {}, statusName: "Archive" }),
          createdAtHash: h(null),
          updatedAtHash: h(null),
        }),
        reservationState: "none",
      },
    ],
    orderItems: [
      imported(1, {
        orderRef: legacyRef(1),
        productRef: legacyRef(1),
        productNameHash: h("Product"),
        skuHash: h("SKU"),
        quantity: 1,
        unitPrice: { kind: "net", amount: "10", taxRate: "23" },
        totalCents: 1230,
      }),
    ],
  };
}
function target() {
  const value = source();
  value.role = "storefront";
  value.products[0].fields.price = {
    kind: "gross_cents",
    amount: 1230,
    taxRate: "23.00",
  } as never;
  value.orderItems[0].fields.unitPrice = {
    kind: "gross_cents",
    amount: 1230,
    taxRate: "23.00",
  } as never;
  return value;
}
const productChange = (report: ReturnType<typeof compareLegacyDelta>) =>
  report.changes.find((row) => row.entity === "products");

test("unchanged imported projection maps string/numeric legacy IDs and gross/net prices", () => {
  const current = target();
  current.products[0].legacyId = "1";
  const report = compareLegacyDelta(source(), source(), current);
  assert.equal(report.changes.length, 0);
  assert.equal(report.counts.products.unchanged, 1);
  assert.equal(report.fullOverwriteAllowed, false);
  assert.equal(report.requiresManualReview, false);
});
test("source-only, target-only and equal concurrent changes remain distinct", () => {
  const final = source(),
    current = target();
  final.products[0].fields.stock = 11;
  assert.equal(
    productChange(compareLegacyDelta(source(), final, current))?.classification,
    "source_only",
  );
  current.products[0].fields.stock = 11;
  assert.equal(
    productChange(compareLegacyDelta(source(), source(), current))
      ?.classification,
    "target_only",
  );
  assert.equal(
    productChange(compareLegacyDelta(source(), final, current))?.classification,
    "same_change",
  );
});
test("non-overlapping target edits require review without pretending they conflict", () => {
  const final = source(),
    current = target();
  final.products[0].fields.stock = 11;
  current.products[0].fields.nameHash = h("Edited in CMS");
  const row = productChange(compareLegacyDelta(source(), final, current));
  assert.equal(row?.classification, "parallel_changes");
  assert.deepEqual(row?.sourceChangedFields, ["stock"]);
  assert.deepEqual(row?.targetChangedFields, ["nameHash"]);
  assert.deepEqual(row?.conflictingFields, []);
});
test("unequal changes to the same field produce a conflict without values", () => {
  const final = source(),
    current = target();
  final.products[0].fields.stock = 11;
  current.products[0].fields.stock = 8;
  const row = productChange(compareLegacyDelta(source(), final, current));
  assert.equal(row?.classification, "conflict");
  assert.deepEqual(row?.conflictingFields, ["stock"]);
  assert.equal("stock" in row!, false);
});
test("new source rows and create collisions are reported", () => {
  const final = source(),
    current = target();
  final.customers.push({ ...final.customers[0], legacyId: 2 });
  let report = compareLegacyDelta(source(), final, current);
  assert.equal(report.changes[0].classification, "source_create");
  current.customers.push({ ...current.customers[0], legacyId: 2 });
  assert.equal(
    compareLegacyDelta(source(), final, current).changes[0].classification,
    "same_create",
  );
  current.customers[1].fields = {
    ...current.customers[1].fields,
    firstNameHash: h("other"),
  };
  report = compareLegacyDelta(source(), final, current);
  assert.equal(report.changes[0].classification, "create_collision");
});
test("source deletion requires review and detects order-item references and target edits", () => {
  const final = source(),
    current = target();
  final.products = [];
  final.orderItems[0].fields.productRef = null as never;
  let row = productChange(compareLegacyDelta(source(), final, current));
  assert.equal(row?.classification, "source_delete");
  assert.ok(
    row?.reasons.includes("deleted_product_referenced_by_target_order_item"),
  );
  current.products[0].fields.stock = 9;
  row = productChange(compareLegacyDelta(source(), final, current));
  assert.equal(row?.classification, "delete_target_changed");
});
test("target deletion and simultaneous source update are distinguished", () => {
  const final = source(),
    current = target();
  current.products = [];
  current.orderItems[0].fields.productRef = null as never;
  assert.equal(
    productChange(compareLegacyDelta(source(), final, current))?.classification,
    "target_delete",
  );
  final.products[0].fields.stock = 11;
  assert.equal(
    productChange(compareLegacyDelta(source(), final, current))?.classification,
    "source_update_target_deleted",
  );
});
test("new UUID-only target rows block full overwrite and preserve mixed relationship identity", () => {
  const final = source(),
    current = target();
  final.products[0].fields.stock = 7;
  current.products[0].reserved = 2;
  current.products[0].stockMovementCount = 1;
  current.orders.push({
    ...current.orders[0],
    legacyId: null,
    targetId: uuid,
    reservationState: "active",
    fields: {
      ...current.orders[0].fields,
      status: "pending_payment",
      stockCommitted: false,
    },
  } as never);
  current.orderItems.push({
    ...current.orderItems[0],
    legacyId: null,
    targetId: uuid2,
    fields: {
      ...current.orderItems[0].fields,
      orderRef: { legacyId: null, targetId: uuid },
    },
  } as never);
  const report = compareLegacyDelta(source(), final, current);
  assert.equal(report.fullOverwriteBlockedByRuntime, true);
  assert.equal(report.runtimeCounts.newStorefrontOrders, 1);
  assert.equal(report.runtimeCounts.activeReservationOrders, 1);
  const row = productChange(report)!;
  assert.ok(row.reasons.includes("stock_has_active_reservations"));
  assert.ok(row.reasons.includes("stock_has_storefront_movements"));
  assert.ok(row.reasons.includes("stock_referenced_by_new_storefront_order"));
  assert.equal(JSON.stringify(report).includes(uuid), false);
});
test("source stock below target reserved quantity remains unsafe even for the same change", () => {
  const final = source(),
    current = target();
  final.products[0].fields.stock = 1;
  current.products[0].reserved = 2;
  const report = compareLegacyDelta(source(), final, current);
  assert.ok(
    productChange(report)?.reasons.includes(
      "source_stock_below_reserved_quantity",
    ),
  );
});
test("money matches current importer rounding and does not treat historical shipping as net", () => {
  for (const [net, tax] of [
    ["10.000000", "23.000000"],
    ["1.005", "0"],
    ["0.145", "0"],
    ["12.35", "8.29"],
  ]) {
    assert.equal(
      legacyNetPriceToGrossCents(net, tax),
      Math.round(Number(net) * (1 + Number(tax) / 100) * 100),
    );
  }
  for (const invalid of ["NaN", "Infinity", "-1", "1e6", "12,35", "1.0000001"])
    assert.throws(
      () => legacyNetPriceToGrossCents(invalid, "23"),
      LegacyDeltaInputError,
    );
  assert.throws(
    () => legacyNetPriceToGrossCents("1", "23.001"),
    LegacyDeltaInputError,
  );
  const final = source();
  final.orders[0].fields.shippingCents = 300;
  final.orders[0].fields.totalCents = 1530;
  assert.deepEqual(
    compareLegacyDelta(source(), final, target()).changes[0]
      .sourceChangedFields,
    ["shippingCents", "totalCents"],
  );
});
test("schema, duplicate IDs, orphan references, cycles and inconsistent amounts fail closed", () => {
  const cases: unknown[] = [];
  cases.push({ ...source(), schemaVersion: 2 });
  cases.push({ ...source(), unknown: "do not print me" });
  const missing = source();
  delete (missing.products[0] as { reserved?: number }).reserved;
  cases.push(missing);
  const duplicate = source();
  duplicate.products.push({ ...duplicate.products[0], legacyId: "1" });
  cases.push(duplicate);
  const orphan = source();
  orphan.orderItems[0].fields.orderRef = legacyRef(123);
  cases.push(orphan);
  const cycle = source();
  cycle.categories[0].fields.parentRef = legacyRef(1) as never;
  cases.push(cycle);
  const badTotal = source();
  badTotal.orderItems[0].fields.totalCents = 1;
  cases.push(badTotal);
  const badStock = source();
  badStock.products[0].reserved = 11;
  cases.push(badStock);
  const unknownRef = source();
  unknownRef.products[0].fields.categoryRefs = [legacyRef(777)];
  cases.push(unknownRef);
  const newSource = source();
  newSource.orders[0].legacyId = null as never;
  cases.push(newSource);
  for (const value of cases)
    assert.throws(
      () => parseLegacyDeltaSnapshot(value, "source"),
      LegacyDeltaInputError,
    );
  assert.throws(
    () => parseLegacyDeltaSnapshot(source(), "storefront"),
    LegacyDeltaInputError,
  );
});
test("report is deterministic and never mutates its inputs or exposes values", () => {
  const baseline = source(),
    final = source(),
    current = target();
  final.products[0].fields.nameHash = h(
    "Very private description and Test Client",
  );
  const inputs = JSON.stringify([baseline, final, current]);
  const report = compareLegacyDelta(baseline, final, current);
  assert.equal(JSON.stringify([baseline, final, current]), inputs);
  assert.deepEqual(compareLegacyDelta(baseline, final, current), report);
  const printed = JSON.stringify(report);
  for (const sensitive of [
    "synthetic@example.test",
    "Synthetic 123",
    "Fixture City",
    "Test Client",
    final.products[0].fields.nameHash,
  ])
    assert.equal(printed.includes(sensitive), false);
  assert.equal(h({ b: 2, a: 1 }), h({ a: 1, b: 2 }));
});
test("CLI writes an exclusive 0600 report, cannot overwrite inputs or an existing report", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "innochem-delta-synthetic-"),
  );
  try {
    const names = [
      "baseline.json",
      "final.json",
      "target.json",
      "report.json",
    ].map((name) => path.join(dir, name));
    for (const [index, value] of [source(), source(), target()].entries())
      await writeFile(names[index], JSON.stringify(value), { mode: 0o600 });
    const args = names.flatMap((name, index) => [
      ["--baseline", "--final", "--target", "--output"][index],
      name,
    ]);
    const before = await Promise.all(
      names.slice(0, 3).map((name) => readFile(name, "utf8")),
    );
    assert.deepEqual(await reportLegacyDelta(args), {
      written: true,
      changes: 0,
      fullOverwriteAllowed: false,
    });
    assert.equal((await stat(names[3])).mode & 0o777, 0o600);
    await assert.rejects(reportLegacyDelta(args));
    await assert.rejects(
      reportLegacyDelta([...args.slice(0, 6), "--output", names[0]]),
    );
    assert.deepEqual(
      await Promise.all(
        names.slice(0, 3).map((name) => readFile(name, "utf8")),
      ),
      before,
    );
    const link = path.join(dir, "symlink.json");
    await symlink(names[0], link);
    await assert.rejects(
      reportLegacyDelta([
        "--baseline",
        link,
        ...args.slice(2, 6),
        "--output",
        path.join(dir, "other.json"),
      ]),
    );
    await assert.rejects(reportLegacyDelta([...args, "--apply", "yes"]));
    await writeFile(names[0], "x".repeat(legacyDeltaMaxInputBytes + 1));
    await assert.rejects(
      reportLegacyDelta([
        ...args.slice(0, 6),
        "--output",
        path.join(dir, "oversize.json"),
      ]),
      LegacyDeltaInputError,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI entry point produces a real report and suppresses malformed JSON and path details", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "innochem-delta-entry-synthetic-"),
  );
  try {
    const names = [
      "baseline.json",
      "final.json",
      "target.json",
      "report.json",
    ].map((name) => path.join(dir, name));
    for (const [index, value] of [source(), source(), target()].entries())
      await writeFile(names[index], JSON.stringify(value), { mode: 0o600 });
    const script = fileURLToPath(
      new URL("../scripts/report-legacy-delta.ts", import.meta.url),
    );
    const args = names.flatMap((name, index) => [
      ["--baseline", "--final", "--target", "--output"][index],
      name,
    ]);
    const run = () =>
      spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
        encoding: "utf8",
        timeout: 30_000,
      });
    const valid = run();
    assert.equal(valid.status, 0, processDiagnostic(valid));
    assert.deepEqual(JSON.parse(valid.stdout), {
      written: true,
      changes: 0,
      fullOverwriteAllowed: false,
    });
    assert.equal(JSON.parse(await readFile(names[3], "utf8")).readOnly, true);
    await writeFile(
      names[0],
      '{"private-email": "synthetic@example.test", broken',
    );
    const badJson = run();
    assert.equal(badJson.status, 1, processDiagnostic(badJson));
    assert.equal(badJson.stdout, "");
    assert.match(badJson.stderr, /Invalid legacy delta snapshot/);
    assert.equal(badJson.stderr.includes("synthetic@example.test"), false);
    assert.equal(badJson.stderr.includes(dir), false);
    args[1] = path.join(dir, "missing-synthetic@example.test.json");
    const badPath = run();
    assert.equal(badPath.status, 1, processDiagnostic(badPath));
    assert.equal(badPath.stderr.includes("synthetic@example.test"), false);
    assert.equal(badPath.stderr.includes(dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

type SyntheticSourceRow = Record<string, string>;
function rawLegacyFixture() {
  const tables: Record<string, SyntheticSourceRow[]> = {
    lang: [{ id_lang: "6", iso_code: "pl" }],
    country: [{ id_country: "14", iso_code: "PL" }],
    tax: [{ id_tax: "1", rate: "23.000" }],
    tax_rule: [{ id_tax_rules_group: "1", id_country: "14", id_tax: "1" }],
    currency: [{ id_currency: "1", iso_code: "PLN" }],
    carrier: [{ id_carrier: "7", name: "Fixture Carrier" }],
    product: [
      {
        id_product: "16",
        id_tax_rules_group: "1",
        price: "10.000000",
        quantity: "10",
        active: "1",
        reference: "TEST",
        weight: "1.000000",
      },
    ],
    product_lang: [
      {
        id_product: "16",
        id_lang: "6",
        name: "Fixture Product",
        link_rewrite: "ignored-special-slug",
        description_short: "<p>Short <b>description</b></p>",
        description: "<p>Info</p>",
        meta_title: "",
        meta_description: "",
      },
    ],
    category: [{ id_category: "2", id_parent: "0", position: "0" }],
    category_lang: [
      {
        id_category: "2",
        id_lang: "6",
        name: "Fixture Oil",
        link_rewrite: "oleje",
        description: "<p>Category</p>",
      },
    ],
    category_product: [{ id_product: "16", id_category: "2" }],
    image: [{ id_image: "9", id_product: "16", cover: "1" }],
    customer: [
      {
        id_customer: "3",
        email: "SYNTHETIC@EXAMPLE.TEST ",
        firstname: "Test",
        lastname: "Client",
        date_add: "2012-01-15 12:30:00",
      },
    ],
    address: [
      {
        id_address: "4",
        id_customer: "3",
        alias: "Primary",
        deleted: "0",
        id_country: "14",
        firstname: "Test",
        lastname: "Client",
        company: "Fixture Company",
        address1: "Synthetic 123",
        address2: "Unit 4",
        postcode: "00-000",
        city: "Fixture City",
        phone_mobile: "123456789",
        phone: "987654321",
        vat_number: "0000000000",
      },
    ],
    orders: [
      {
        id_order: "5",
        id_customer: "3",
        id_address_invoice: "4",
        id_address_delivery: "4",
        total_shipping: "2.00",
        total_paid: "14.30",
        total_products_wt: "12.30",
        id_currency: "1",
        id_carrier: "7",
        payment: "Bank transfer",
        shipping_number: "",
        date_add: "2012-01-15 12:30:00",
        date_upd: "2012-07-15 12:30:00",
        secure_key: "synthetic-secret-not-real",
      },
    ],
    order_detail: [
      {
        id_order_detail: "8",
        id_order: "5",
        product_id: "16",
        product_name: "Fixture Product",
        product_reference: "TEST",
        product_quantity: "1",
        product_price: "10.000000",
        tax_rate: "23.000",
      },
    ],
    order_history: [
      {
        id_order_history: "6",
        id_order: "5",
        id_order_state: "2",
        date_add: "2012-07-15 12:30:00",
      },
    ],
    order_state_lang: [
      { id_order_state: "2", id_lang: "6", name: "Delivered" },
    ],
    wp_posts: [{ ID: "99", post_title: "Ignored fixture page" }],
  };
  return { source_sha256: h("synthetic-source"), tables };
}
const syntheticInventory = () => [
  {
    source_path: "sklep/img/p/16-9.jpg",
    path: "/media/sklep/img/p/16-9.jpg",
    size_bytes: 10,
    sha256: h("synthetic-image"),
  },
];
const targetUuid = (index: number) =>
  `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
function pgFixture() {
  const raw = rawLegacyFixture();
  const address = {
    firstName: "Test",
    lastName: "Client",
    company: "Fixture Company",
    street: "Synthetic 123, Unit 4",
    postalCode: "00-000",
    city: "Fixture City",
    country: "PL",
    phone: "123456789",
    nip: "0000000000",
  };
  const original = { ...raw.tables.orders[0] };
  delete original.secure_key;
  const rows: Record<string, Record<string, unknown>[]> = {
    categories: [
      {
        id: targetUuid(1),
        legacy_id: 2,
        slug: "oleje",
        name: "Fixture Oil",
        description_html: "<p>Category</p>",
        parent_id: null,
        visible: true,
        position: 0,
      },
    ],
    products: [
      {
        id: targetUuid(2),
        legacy_id: 16,
        slug: "hps-5w30",
        sku: "TEST",
        name: "Fixture Product",
        summary: "Short description",
        description_html: "<p>Info</p>",
        price_cents: 1230,
        tax_rate: "23.00",
        stock: 10,
        reserved: 0,
        status: "active",
        sale_mode: "retail",
        weight_grams: 1000,
        image_path: "/media/sklep/img/p/16-9.jpg",
        image_alt: "Fixture Product",
        meta_title: "Fixture Product",
        meta_description: "Short description",
      },
    ],
    customers: [
      {
        id: targetUuid(3),
        legacy_id: 3,
        email: "synthetic@example.test",
        first_name: "Test",
        last_name: "Client",
        source_created_at: new Date("2012-01-15T11:30:00.000Z"),
      },
    ],
    addresses: [
      {
        id: targetUuid(4),
        legacy_id: 4,
        customer_id: targetUuid(3),
        label: "Primary",
        data: address,
        archived: false,
      },
    ],
    orders: [
      {
        id: targetUuid(5),
        legacy_id: 5,
        customer_id: targetUuid(3),
        email: "SYNTHETIC@EXAMPLE.TEST ",
        buyer: { ...address, email: "SYNTHETIC@EXAMPLE.TEST " },
        shipping_address: address,
        status: "legacy",
        payment_method: "Bank transfer",
        currency: "PLN",
        subtotal_cents: 1230,
        shipping_cents: 200,
        total_cents: 1430,
        shipping_method: "legacy-7",
        shipping_label: "Fixture Carrier",
        tracking_number: null,
        stock_committed: true,
        terms_version: "legacy",
        source_data: { original, statusName: "Delivered" },
        created_at: new Date("2012-01-15T11:30:00.000Z"),
        updated_at: new Date("2012-07-15T10:30:00.000Z"),
        reservation_state: "none",
      },
    ],
    order_items: [
      {
        id: targetUuid(8),
        legacy_id: 8,
        order_id: targetUuid(5),
        product_id: targetUuid(2),
        product_name: "Fixture Product",
        sku: "TEST",
        quantity: 1,
        unit_price_cents: 1230,
        tax_rate: "23.00",
        total_cents: 1230,
      },
    ],
    relations: [{ product_id: targetUuid(2), category_id: targetUuid(1) }],
    movements: [],
  };
  const queries: string[] = [];
  const client = {
    dedicatedConnection: true as const,
    async query(sql: string) {
      queries.push(sql);
      const table = sql.match(
        / FROM (categories|products|customers|addresses|orders|order_items) ORDER BY id LIMIT 100001$/,
      )?.[1];
      if (table) return { rows: rows[table] };
      if (sql.startsWith("SELECT product_id::text,category_id::text"))
        return { rows: rows.relations };
      if (sql.startsWith("SELECT product_id::text,count(*)::text"))
        return { rows: rows.movements };
      if (
        sql.startsWith("BEGIN ") ||
        sql.startsWith("SET LOCAL ") ||
        sql === "ROLLBACK"
      )
        return { rows: [] };
      throw new Error("Unexpected synthetic SQL");
    },
  };
  return { rows, client, queries };
}

test("raw adapter and readonly target exporter round-trip identity, money, timestamps and hashed fields", async () => {
  const raw = rawLegacyFixture(),
    inventory = syntheticInventory(),
    pg = pgFixture();
  const unchanged = JSON.stringify([raw, inventory]);
  const normalized = normalizeLegacyDeltaSource(raw, inventory);
  const current = await exportLegacyDeltaTarget(pg.client);
  const report = compareLegacyDelta(
    normalized.snapshot,
    normalized.snapshot,
    current,
  );
  assert.equal(report.changes.length, 0, JSON.stringify(report.changes));
  assert.equal(JSON.stringify([raw, inventory]), unchanged);
  assert.deepEqual(normalizeLegacyDeltaSource(raw, inventory), normalized);
  assert.deepEqual(normalized.ignoredTableCounts, { wp_posts: 1 });
  const product = normalized.snapshot.products[0] as {
    legacyId: string;
    fields: { price: object; categoryRefs: object[] };
  };
  assert.equal(product.legacyId, "16");
  assert.deepEqual(product.fields.categoryRefs, [{ legacyId: "2" }]);
  assert.deepEqual(product.fields.price, {
    kind: "net",
    amount: "10.000000",
    taxRate: "23.000",
  });
  for (const value of [
    "synthetic@example.test",
    "SYNTHETIC@EXAMPLE.TEST",
    "Synthetic 123",
    "Fixture City",
    "Fixture Product",
    "synthetic-secret-not-real",
  ]) {
    assert.equal(JSON.stringify(normalized).includes(value), false);
    assert.equal(JSON.stringify(current).includes(value), false);
  }
  assert.equal(
    pg.queries[0],
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  assert.equal(pg.queries.at(-1), "ROLLBACK");
  assert.ok(
    pg.queries.every(
      (sql) =>
        !/\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE)\b/i.test(
          sql,
        ),
    ),
  );
  assert.ok(
    pg.queries.find((sql) =>
      sql.includes("ps.state IN ('creating','open','processing')"),
    ),
  );
});
test("adapter preserves deliberate detached history and counts exclusions without printing IDs or PII", () => {
  const raw = rawLegacyFixture();
  raw.tables.customer = [];
  raw.tables.order_detail[0].product_id = "999";
  const normalized = normalizeLegacyDeltaSource(raw, syntheticInventory());
  assert.equal(normalized.exclusions.detachedAddresses, 1);
  assert.equal(normalized.exclusions.ordersWithoutCustomer, 1);
  assert.equal(normalized.exclusions.historicalItemsWithoutProduct, 1);
  assert.equal(normalized.snapshot.addresses.length, 0);
  const parsed = parseLegacyDeltaSnapshot(normalized.snapshot, "source");
  assert.equal(parsed.orders[0].fields.customerRef, null);
  assert.equal(parsed.orderItems[0].fields.productRef, null);
});
test("adapter fails on malformed consumed schema, orphan links, duplicate IDs, tax ambiguity and line totals", () => {
  const cases = [];
  const missing = rawLegacyFixture();
  delete missing.tables.product[0].quantity;
  cases.push(missing);
  const orphan = rawLegacyFixture();
  orphan.tables.category_product[0].id_category = "999";
  cases.push(orphan);
  const orphanItem = rawLegacyFixture();
  orphanItem.tables.order_detail[0].id_order = "999";
  cases.push(orphanItem);
  const duplicate = rawLegacyFixture();
  duplicate.tables.product.push({ ...duplicate.tables.product[0] });
  cases.push(duplicate);
  const tax = rawLegacyFixture();
  tax.tables.tax_rule.push({ ...tax.tables.tax_rule[0] });
  cases.push(tax);
  const totals = rawLegacyFixture();
  totals.tables.orders[0].total_products_wt = "10.00";
  cases.push(totals);
  const invalidHistory = rawLegacyFixture();
  invalidHistory.tables.order_history[0].date_add = "invalid-date";
  cases.push(invalidHistory);
  const unknown = rawLegacyFixture();
  unknown.tables.unknown_new_schema = [];
  cases.push(unknown);
  const type = rawLegacyFixture();
  type.tables.product[0].quantity = 1 as never;
  cases.push(type);
  for (const value of cases)
    assert.throws(
      () => normalizeLegacyDeltaSource(value, syntheticInventory()),
      LegacyDeltaInputError,
    );
  assert.throws(
    () =>
      normalizeLegacyDeltaSource(rawLegacyFixture(), [
        ...syntheticInventory(),
        ...syntheticInventory(),
      ]),
    LegacyDeltaInputError,
  );
});
test("adapter retains missing historical address snapshots as empty objects with explicit counts", () => {
  const raw = rawLegacyFixture();
  raw.tables.orders[0].id_address_invoice = "777";
  raw.tables.orders[0].id_address_delivery = "888";
  const normalized = normalizeLegacyDeltaSource(raw, syntheticInventory());
  const snapshot = parseLegacyDeltaSnapshot(normalized.snapshot, "source");
  assert.equal(normalized.exclusions.ordersWithoutInvoiceAddress, 1);
  assert.equal(normalized.exclusions.ordersWithoutDeliveryAddress, 1);
  assert.equal(snapshot.orders[0].fields.shippingAddressHash, h({}));
  assert.equal(
    snapshot.orders[0].fields.buyerHash,
    h({ email: "SYNTHETIC@EXAMPLE.TEST " }),
  );
});
test("Warsaw timestamps preserve summer/winter and PostgreSQL preference at DST transitions", () => {
  assert.equal(
    legacyWarsawTimestamp("2012-01-15 12:30:00"),
    "2012-01-15T11:30:00.000Z",
  );
  assert.equal(
    legacyWarsawTimestamp("2012-07-15 12:30:00"),
    "2012-07-15T10:30:00.000Z",
  );
  assert.equal(
    legacyWarsawTimestamp("2026-10-25 02:30:00"),
    "2026-10-25T01:30:00.000Z",
  );
  assert.equal(
    legacyWarsawTimestamp("2026-03-29 02:30:00"),
    "2026-03-29T01:30:00.000Z",
  );
  assert.equal(legacyWarsawTimestamp("0000-00-00 00:00:00"), null);
  for (const value of [
    "2026-02-31 12:00:00",
    "2026-13-01 00:00:00",
    "2026-01-01",
    "invalid",
  ])
    assert.throws(() => legacyWarsawTimestamp(value), LegacyDeltaInputError);
});
test("readonly exporter preserves new target UUID links, runtime protection and no clear values", async () => {
  const pg = pgFixture(),
    normalized = normalizeLegacyDeltaSource(
      rawLegacyFixture(),
      syntheticInventory(),
    );
  pg.rows.products[0].reserved = 2;
  pg.rows.movements.push({ product_id: targetUuid(2), movement_count: "1" });
  pg.rows.orders.push({
    ...pg.rows.orders[0],
    id: targetUuid(9),
    legacy_id: null,
    status: "pending_payment",
    stock_committed: false,
    reservation_state: "active",
    subtotal_cents: 2460,
    total_cents: 2660,
  });
  pg.rows.order_items.push({
    ...pg.rows.order_items[0],
    id: targetUuid(10),
    legacy_id: null,
    order_id: targetUuid(9),
    quantity: 2,
    total_cents: 2460,
  });
  const snapshot = await exportLegacyDeltaTarget(pg.client);
  const report = compareLegacyDelta(
    normalized.snapshot,
    normalized.snapshot,
    snapshot,
  );
  assert.equal(report.runtimeCounts.newStorefrontOrders, 1);
  assert.equal(report.runtimeCounts.reservedProducts, 1);
  assert.equal(report.runtimeCounts.productsWithStockMovements, 1);
  assert.equal(report.fullOverwriteBlockedByRuntime, true);
  assert.equal(report.fullOverwriteAllowed, false);
  assert.equal(pg.queries.at(-1), "ROLLBACK");
});
test("readonly exporter rolls back malformed identities, missing relationships and arbitrary SQL errors", async () => {
  const pg = pgFixture();
  pg.rows.addresses[0].customer_id = targetUuid(99);
  await assert.rejects(
    exportLegacyDeltaTarget(pg.client),
    LegacyDeltaInputError,
  );
  assert.equal(pg.queries.at(-1), "ROLLBACK");
  const broken = pgFixture();
  broken.rows.products[0].legacy_id = 0;
  await assert.rejects(
    exportLegacyDeltaTarget(broken.client),
    LegacyDeltaInputError,
  );
  assert.equal(broken.queries.at(-1), "ROLLBACK");
  const queryLog: string[] = [];
  await assert.rejects(
    exportLegacyDeltaTarget({
      dedicatedConnection: true,
      async query(sql) {
        queryLog.push(sql);
        if (sql.startsWith("SELECT "))
          throw new Error("synthetic query failure");
        return { rows: [] };
      },
    }),
  );
  assert.equal(queryLog.at(-1), "ROLLBACK");
});
test("export environment requires matching explicit database, host/user and read-only opt-in", () => {
  const env = {
    INNOCHEM_DELTA_EXPORT_READ_ONLY: "1",
    PGDATABASE: "innochem_test_fixture",
    PGHOST: "/synthetic/socket",
    PGUSER: "fixture",
  };
  assert.deepEqual(legacyDeltaExportEnvironment(env, "innochem_test_fixture"), {
    readOnly: true,
    explicitDatabaseConfirmed: true,
  });
  for (const unsafe of [
    { ...env, INNOCHEM_DELTA_EXPORT_READ_ONLY: undefined },
    { ...env, PGDATABASE: "other_database" },
    { ...env, PGHOST: "" },
    { ...env, PGUSER: "" },
    { ...env, PGOPTIONS: "-c default_transaction_read_only=off" },
    { ...env, PGPORT: "0" },
  ])
    assert.throws(
      () => legacyDeltaExportEnvironment(unsafe, "innochem_test_fixture"),
      LegacyDeltaInputError,
    );
});
test("readonly exporter rejects changed raw column types and malformed JSON objects", async () => {
  for (const corrupt of [
    (pg: ReturnType<typeof pgFixture>) => {
      pg.rows.customers[0].email = 7;
    },
    (pg: ReturnType<typeof pgFixture>) => {
      pg.rows.addresses[0].data = [];
    },
    (pg: ReturnType<typeof pgFixture>) => {
      pg.rows.products[0].image_path = {};
    },
    (pg: ReturnType<typeof pgFixture>) => {
      pg.rows.orders[0].buyer = null;
    },
  ]) {
    const pg = pgFixture();
    corrupt(pg);
    await assert.rejects(
      exportLegacyDeltaTarget(pg.client),
      LegacyDeltaInputError,
    );
    assert.equal(pg.queries.at(-1), "ROLLBACK");
  }
});
test("export helper refuses an unasserted shared query interface before starting any transaction", async () => {
  const queries: string[] = [];
  const shared = {
    async query(sql: string) {
      queries.push(sql);
      return { rows: [] };
    },
  };
  await assert.rejects(
    exportLegacyDeltaTarget(shared as never),
    LegacyDeltaInputError,
  );
  assert.deepEqual(queries, []);
});
test("source CLI writes private normalized files and guarded exporter never connects without opt-in", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "innochem-delta-normalize-synthetic-"),
  );
  try {
    const input = path.join(dir, "raw.json"),
      inventory = path.join(dir, "inventory.json"),
      output = path.join(dir, "normalized.json");
    await writeFile(input, JSON.stringify(rawLegacyFixture()), { mode: 0o600 });
    await writeFile(inventory, JSON.stringify(syntheticInventory()), {
      mode: 0o600,
    });
    const args = [
      "--input",
      input,
      "--media-inventory",
      inventory,
      "--output",
      output,
    ];
    const summary = await normalizeLegacyDeltaFiles(args);
    assert.equal(summary.written, true);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    parseLegacyDeltaSnapshot(
      JSON.parse(await readFile(output, "utf8")),
      "source",
    );
    await assert.rejects(normalizeLegacyDeltaFiles(args));
    const script = fileURLToPath(
      new URL("../scripts/report-legacy-delta.ts", import.meta.url),
    );
    const guarded = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        script,
        "export-target",
        "--database",
        "innochem_test_fixture",
        "--output",
        path.join(dir, "target.json"),
        "--confirm-read-only",
      ],
      { encoding: "utf8", timeout: 30_000, env: { PATH: process.env.PATH } },
    );
    assert.equal(guarded.status, 1, processDiagnostic(guarded));
    assert.match(guarded.stderr, /Invalid legacy delta snapshot/);
    assert.equal(guarded.stderr.includes(dir), false);
    await assert.rejects(stat(path.join(dir, "target.json")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
