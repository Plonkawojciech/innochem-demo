import { createHash } from "node:crypto";
import { z } from "zod";

export const legacyDeltaEntities = [
  "categories",
  "products",
  "customers",
  "addresses",
  "orders",
  "orderItems",
] as const;
export type LegacyDeltaEntity = (typeof legacyDeltaEntities)[number];
const integer = z.number().int().min(0).max(2_147_483_647);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const legacyId = z
  .union([z.number().int().positive(), z.string().regex(/^[1-9][0-9]*$/)])
  .refine((id) => Number(id) <= 2_147_483_647)
  .transform(String);
const identity = z
  .object({ legacyId: legacyId.nullable(), targetId: z.uuid().optional() })
  .strict()
  .refine((id) => id.legacyId !== null || !!id.targetId);
const ref = identity;
const decimal = z.string().regex(/^(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,6})?$/);
const rate = decimal.refine(
  (value) =>
    Number(value) <= 100 && /^0*$/.test((value.split(".")[1] || "").slice(2)),
);
const price = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("net"), amount: decimal, taxRate: rate }).strict(),
  z
    .object({ kind: z.literal("gross_cents"), amount: integer, taxRate: rate })
    .strict(),
]);
const fields = {
  categories: z
    .object({
      slugHash: hash,
      nameHash: hash,
      descriptionHtmlHash: hash,
      parentRef: ref.nullable(),
      visible: z.boolean(),
      position: integer,
    })
    .strict(),
  products: z
    .object({
      slugHash: hash,
      skuHash: hash,
      nameHash: hash,
      summaryHash: hash,
      descriptionHtmlHash: hash,
      price,
      stock: integer,
      status: z.enum(["draft", "active", "archived"]),
      saleMode: z.enum(["retail", "inquiry"]),
      weightGrams: integer,
      imagePathHash: hash,
      imageAltHash: hash,
      metaTitleHash: hash,
      metaDescriptionHash: hash,
      categoryRefs: z.array(ref).max(10_000),
    })
    .strict(),
  customers: z
    .object({
      emailHash: hash,
      firstNameHash: hash,
      lastNameHash: hash,
      sourceCreatedAtHash: hash,
    })
    .strict(),
  addresses: z
    .object({
      customerRef: ref,
      labelHash: hash,
      dataHash: hash,
      archived: z.boolean(),
    })
    .strict(),
  orders: z
    .object({
      customerRef: ref.nullable(),
      emailHash: hash,
      buyerHash: hash,
      shippingAddressHash: hash,
      status: z.enum([
        "pending_payment",
        "paid",
        "processing",
        "shipped",
        "completed",
        "cancelled",
        "refunded",
        "payment_review",
        "legacy",
      ]),
      paymentMethodHash: hash,
      currency: z.string().regex(/^[A-Z]{3}$/),
      subtotalCents: integer,
      shippingCents: integer,
      totalCents: integer,
      shippingMethodHash: hash,
      shippingLabelHash: hash,
      trackingNumberHash: hash,
      stockCommitted: z.boolean(),
      termsVersionHash: hash,
      sourceDataHash: hash,
      createdAtHash: hash,
      updatedAtHash: hash,
    })
    .strict()
    .refine((row) => row.totalCents === row.subtotalCents + row.shippingCents),
  orderItems: z
    .object({
      orderRef: ref,
      productRef: ref.nullable(),
      productNameHash: hash,
      skuHash: hash,
      quantity: integer.refine((value) => value > 0),
      unitPrice: price,
      totalCents: integer,
    })
    .strict(),
};
const record = (entity: LegacyDeltaEntity) =>
  z
    .object({
      legacyId: legacyId.nullable(),
      targetId: z.uuid().optional(),
      fields: fields[entity],
      ...(entity === "products"
        ? { reserved: integer, stockMovementCount: integer }
        : {}),
      ...(entity === "orders"
        ? { reservationState: z.enum(["none", "active", "expired"]) }
        : {}),
    })
    .strict();
const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    role: z.enum(["source", "storefront"]),
    categories: z.array(record("categories")).max(100_000),
    products: z.array(record("products")).max(100_000),
    customers: z.array(record("customers")).max(100_000),
    addresses: z.array(record("addresses")).max(100_000),
    orders: z.array(record("orders")).max(100_000),
    orderItems: z.array(record("orderItems")).max(100_000),
  })
  .strict();

type Reference = { legacyId: string | null; targetId?: string };
type Row = Reference & {
  fields: Record<string, unknown>;
  reserved?: number;
  stockMovementCount?: number;
  reservationState?: "none" | "active" | "expired";
};
export type LegacyDeltaSnapshot = {
  schemaVersion: 1;
  role: "source" | "storefront";
} & Record<LegacyDeltaEntity, Row[]>;

export class LegacyDeltaInputError extends Error {
  constructor() {
    super(
      "Invalid legacy delta snapshot; validate the versioned schema and relationships locally",
    );
    this.name = "LegacyDeltaInputError";
  }
}

/** Stable object-key ordering, but array order remains meaningful. Never log this value. */
function canonical(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return JSON.stringify(value);
  if (typeof value !== "object") throw new LegacyDeltaInputError();
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new LegacyDeltaInputError();
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}
export function legacyDeltaHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

/** Matches import-legacy.ts/import-history.ts, including their Number/Math.round semantics. */
export function legacyNetPriceToGrossCents(
  net: string,
  taxRate: string,
): number {
  if (!decimal.safeParse(net).success || !rate.safeParse(taxRate).success)
    throw new LegacyDeltaInputError();
  const value = Math.round(Number(net) * (1 + Number(taxRate) / 100) * 100);
  if (!integer.safeParse(value).success) throw new LegacyDeltaInputError();
  return value;
}
function key(row: Reference): string {
  return row.legacyId === null
    ? `target:${row.targetId!.toLowerCase()}`
    : `legacy:${row.legacyId}`;
}
function normalizeReference(value: unknown): Reference {
  const parsed = ref.safeParse(value);
  if (!parsed.success) throw new LegacyDeltaInputError();
  // An imported row is identified by legacy ID, regardless of its current UUID.
  return parsed.data.legacyId === null
    ? { legacyId: null, targetId: parsed.data.targetId!.toLowerCase() }
    : { legacyId: parsed.data.legacyId };
}
function normalizeFields(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(input)) {
    if (name === "price" || name === "unitPrice") {
      const p = value as z.infer<typeof price>;
      output[name === "price" ? "priceCents" : "unitPriceCents"] =
        p.kind === "net"
          ? legacyNetPriceToGrossCents(p.amount, p.taxRate)
          : p.amount;
      output.taxRateBasisPoints = Math.round(Number(p.taxRate) * 100);
    } else if (name === "categoryRefs") {
      const refs = (value as unknown[])
        .map(normalizeReference)
        .sort((a, b) => key(a).localeCompare(key(b)));
      if (new Set(refs.map(key)).size !== refs.length)
        throw new LegacyDeltaInputError();
      output[name] = refs;
    } else if (name.endsWith("Ref")) {
      output[name] = value === null ? null : normalizeReference(value);
    } else output[name] = value;
  }
  return output;
}

/** Accepts ONLY the documented normalized projection, never raw legacy-data.json. */
export function parseLegacyDeltaSnapshot(
  input: unknown,
  expectedRole: "source" | "storefront",
): LegacyDeltaSnapshot {
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success || parsed.data.role !== expectedRole)
    throw new LegacyDeltaInputError();
  const result = parsed.data as unknown as LegacyDeltaSnapshot;
  if (
    legacyDeltaEntities.reduce(
      (sum, entity) => sum + result[entity].length,
      0,
    ) > 100_000
  )
    throw new LegacyDeltaInputError();
  const maps = new Map<LegacyDeltaEntity, Map<string, Row>>();
  for (const entity of legacyDeltaEntities) {
    const rows = result[entity];
    const map = new Map<string, Row>();
    const targetIds = new Set<string>();
    for (const row of rows) {
      if (
        (expectedRole === "source" &&
          (row.legacyId === null || row.targetId !== undefined)) ||
        (row.legacyId === null && !row.targetId)
      )
        throw new LegacyDeltaInputError();
      if (row.targetId) {
        row.targetId = row.targetId.toLowerCase();
        if (targetIds.has(row.targetId)) throw new LegacyDeltaInputError();
        targetIds.add(row.targetId);
      }
      if (map.has(key(row))) throw new LegacyDeltaInputError();
      row.fields = normalizeFields(row.fields);
      if (entity === "products") {
        if (
          row.reserved! > Number(row.fields.stock) ||
          (expectedRole === "source" &&
            (row.reserved !== 0 || row.stockMovementCount !== 0))
        )
          throw new LegacyDeltaInputError();
      }
      if (
        entity === "orders" &&
        expectedRole === "source" &&
        (row.reservationState !== "none" || row.fields.status !== "legacy")
      )
        throw new LegacyDeltaInputError();
      if (
        entity === "orderItems" &&
        row.fields.totalCents !==
          Number(row.fields.unitPriceCents) * Number(row.fields.quantity)
      )
        throw new LegacyDeltaInputError();
      map.set(key(row), row);
    }
    maps.set(entity, map);
  }
  const relation = (target: LegacyDeltaEntity, value: unknown) => {
    if (value !== null && !maps.get(target)!.has(key(value as Reference)))
      throw new LegacyDeltaInputError();
  };
  for (const row of result.categories)
    relation("categories", row.fields.parentRef);
  for (const row of result.products)
    for (const value of row.fields.categoryRefs as Reference[])
      relation("categories", value);
  for (const row of result.addresses)
    relation("customers", row.fields.customerRef);
  for (const row of result.orders)
    relation("customers", row.fields.customerRef);
  for (const row of result.orderItems) {
    relation("orders", row.fields.orderRef);
    relation("products", row.fields.productRef);
  }
  // A category tree cannot contain a self-reference or a cycle.
  const complete = new Set<string>();
  for (const row of result.categories) {
    const visiting = new Set<string>();
    let current: Row | undefined = row;
    while (current && !complete.has(key(current))) {
      if (visiting.has(key(current))) throw new LegacyDeltaInputError();
      visiting.add(key(current));
      const parent = current.fields.parentRef as Reference | null;
      current = parent ? maps.get("categories")!.get(key(parent)) : undefined;
    }
    for (const id of visiting) complete.add(id);
  }
  return result;
}

type Change = {
  entity: LegacyDeltaEntity;
  legacyId: string | null;
  targetIdHash?: string;
  classification: string;
  sourceChangedFields: string[];
  targetChangedFields: string[];
  conflictingFields: string[];
  reasons: string[];
};
function changed(before: Row, after: Row): string[] {
  return Object.keys(before.fields)
    .sort()
    .filter(
      (name) =>
        canonical(before.fields[name]) !== canonical(after.fields[name]),
    );
}
function equal(a: Row, b: Row): boolean {
  return changed(a, b).length === 0;
}

export function compareLegacyDelta(
  baselineInput: unknown,
  finalInput: unknown,
  targetInput: unknown,
) {
  // Zod produces fresh objects; neither caller snapshots nor fields are mutated.
  const baseline = parseLegacyDeltaSnapshot(baselineInput, "source");
  const final = parseLegacyDeltaSnapshot(finalInput, "source");
  const target = parseLegacyDeltaSnapshot(targetInput, "storefront");
  const newOrders = target.orders.filter((row) => row.legacyId === null);
  const reservedProducts = target.products.filter((row) => row.reserved! > 0);
  const activeOrders = target.orders.filter(
    (row) => row.reservationState === "active",
  );
  const movedProducts = target.products.filter(
    (row) => row.stockMovementCount! > 0,
  );
  const newOrderKeys = new Set(newOrders.map(key));
  const referencedProducts = new Set<string>();
  const newOrderProducts = new Set<string>();
  for (const line of target.orderItems) {
    if (line.fields.productRef === null) continue;
    const product = key(line.fields.productRef as Reference);
    referencedProducts.add(product);
    if (newOrderKeys.has(key(line.fields.orderRef as Reference)))
      newOrderProducts.add(product);
  }
  const changes: Change[] = [];
  const counts = Object.fromEntries(
    legacyDeltaEntities.map((entity) => [
      entity,
      {
        baseline: baseline[entity].length,
        final: final[entity].length,
        target: target[entity].length,
        unchanged: 0,
        changes: 0,
      },
    ]),
  ) as Record<
    LegacyDeltaEntity,
    {
      baseline: number;
      final: number;
      target: number;
      unchanged: number;
      changes: number;
    }
  >;
  for (const entity of legacyDeltaEntities) {
    const b = new Map(baseline[entity].map((row) => [key(row), row]));
    const f = new Map(final[entity].map((row) => [key(row), row]));
    const t = new Map(target[entity].map((row) => [key(row), row]));
    const ids = [...new Set([...b.keys(), ...f.keys(), ...t.keys()])].sort();
    for (const id of ids) {
      const before = b.get(id),
        source = f.get(id),
        current = t.get(id);
      const row = source || before || current!;
      const change: Change = {
        entity,
        legacyId: row.legacyId,
        ...(row.legacyId === null
          ? { targetIdHash: legacyDeltaHash(row.targetId) }
          : {}),
        classification: "unchanged",
        sourceChangedFields: [],
        targetChangedFields: [],
        conflictingFields: [],
        reasons: [],
      };
      if (!before) {
        if (source && current)
          change.classification = equal(source, current)
            ? "same_create"
            : "create_collision";
        else change.classification = source ? "source_create" : "target_create";
        if (source)
          change.sourceChangedFields = Object.keys(source.fields).sort();
        if (current)
          change.targetChangedFields = Object.keys(current.fields).sort();
        if (source && current && !equal(source, current))
          change.conflictingFields = changed(source, current);
      } else if (!source) {
        change.classification = !current
          ? "same_delete"
          : equal(before, current)
            ? "source_delete"
            : "delete_target_changed";
        change.sourceChangedFields = Object.keys(before.fields).sort();
        if (current) change.targetChangedFields = changed(before, current);
        change.reasons.push(
          "deletion_requires_relationship_and_retention_review",
        );
      } else if (!current) {
        change.sourceChangedFields = changed(before, source);
        change.targetChangedFields = Object.keys(before.fields).sort();
        change.classification = change.sourceChangedFields.length
          ? "source_update_target_deleted"
          : "target_delete";
      } else {
        change.sourceChangedFields = changed(before, source);
        change.targetChangedFields = changed(before, current);
        change.conflictingFields = change.sourceChangedFields.filter(
          (name) =>
            change.targetChangedFields.includes(name) &&
            canonical(source.fields[name]) !== canonical(current.fields[name]),
        );
        change.classification = change.conflictingFields.length
          ? "conflict"
          : !change.sourceChangedFields.length
            ? change.targetChangedFields.length
              ? "target_only"
              : "unchanged"
            : !change.targetChangedFields.length
              ? "source_only"
              : equal(source, current)
                ? "same_change"
                : "parallel_changes";
      }
      const stockChanged =
        entity === "products" &&
        (!!source !== !!before || change.sourceChangedFields.includes("stock"));
      if (stockChanged && current) {
        if (current.reserved! > 0)
          change.reasons.push("stock_has_active_reservations");
        if (current.stockMovementCount! > 0)
          change.reasons.push("stock_has_storefront_movements");
        if (newOrderProducts.has(id))
          change.reasons.push("stock_referenced_by_new_storefront_order");
        if (source && Number(source.fields.stock) < current.reserved!)
          change.reasons.push("source_stock_below_reserved_quantity");
        if (!source && referencedProducts.has(id))
          change.reasons.push(
            "deleted_product_referenced_by_target_order_item",
          );
      }
      if (entity === "orders" && current?.legacyId === null)
        change.reasons.push("new_storefront_order_blocks_full_overwrite");
      if (change.classification === "unchanged") counts[entity].unchanged++;
      else {
        changes.push(change);
        counts[entity].changes++;
      }
    }
  }
  return {
    schemaVersion: 1,
    readOnly: true,
    automaticApplySupported: false,
    fullOverwriteAllowed: false,
    fullOverwriteBlockedByRuntime:
      newOrders.length > 0 ||
      reservedProducts.length > 0 ||
      activeOrders.length > 0 ||
      movedProducts.length > 0,
    requiresManualReview:
      changes.length > 0 ||
      reservedProducts.length > 0 ||
      activeOrders.length > 0 ||
      movedProducts.length > 0,
    snapshotHashes: {
      baseline: legacyDeltaHash(baseline),
      final: legacyDeltaHash(final),
      target: legacyDeltaHash(target),
    },
    runtimeCounts: {
      newStorefrontOrders: newOrders.length,
      reservedProducts: reservedProducts.length,
      activeReservationOrders: activeOrders.length,
      productsWithStockMovements: movedProducts.length,
    },
    counts,
    changes,
    outsideScope: [
      "media_bytes",
      "pages",
      "redirects",
      "order_events",
      "legacy_records",
      "auth_accounts",
      "provider_configuration",
      "payment_sessions",
      "shipments",
      "mail",
      "analytics",
    ],
  };
}
