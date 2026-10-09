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
} from "../lib/legacy-delta";
import {
  reportLegacyDelta,
  legacyDeltaMaxInputBytes,
} from "../scripts/report-legacy-delta";

const h = (value: unknown) => legacyDeltaHash(value);
const imported = <T extends object>(legacyId: string | number, fields: T) => ({
  legacyId,
  fields,
});
const uuid = "00000000-0000-4000-8000-000000000001";
const uuid2 = "00000000-0000-4000-8000-000000000002";
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
        timeout: 10_000,
      });
    const valid = run();
    assert.equal(valid.status, 0, valid.stderr);
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
    assert.equal(badJson.status, 1);
    assert.equal(badJson.stdout, "");
    assert.match(badJson.stderr, /Invalid legacy delta snapshot/);
    assert.equal(badJson.stderr.includes("synthetic@example.test"), false);
    assert.equal(badJson.stderr.includes(dir), false);
    args[1] = path.join(dir, "missing-synthetic@example.test.json");
    const badPath = run();
    assert.equal(badPath.status, 1);
    assert.equal(badPath.stderr.includes("synthetic@example.test"), false);
    assert.equal(badPath.stderr.includes(dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
