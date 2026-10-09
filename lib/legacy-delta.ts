import { createHash } from "node:crypto";
import { z } from "zod";
import { cleanHtml, plainText } from "./server/content";

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

type SourceRow = Record<string, string>;
const sourceTables = [
  "product",
  "product_lang",
  "category",
  "category_lang",
  "category_product",
  "image",
  "image_lang",
  "tax",
  "tax_rule",
  "tax_rules_group",
  "lang",
  "currency",
  "country",
  "country_lang",
  "carrier",
  "delivery",
  "range_price",
  "range_weight",
  "cms",
  "cms_lang",
  "order_state",
  "order_state_lang",
  "order_detail",
  "order_history",
  "orders",
  "message",
  "invoice_or_bill",
  "product_attribute",
  "product_attribute_combination",
  "product_attachment",
  "attachment",
  "attachment_lang",
  "stock_mvt",
  "customer",
  "address",
  "wp_posts",
  "wp_postmeta",
  "wp_terms",
  "wp_term_taxonomy",
  "wp_term_relationships",
];
const consumedTables = [
  "product",
  "product_lang",
  "category",
  "category_lang",
  "category_product",
  "image",
  "tax",
  "tax_rule",
  "lang",
  "currency",
  "country",
  "carrier",
  "order_state_lang",
  "order_detail",
  "order_history",
  "orders",
  "customer",
  "address",
];
const sourceSchema = z
  .object({
    source_sha256: hash.optional(),
    tables: z.record(
      z.string().regex(/^[a-z][a-z0-9_]*$/),
      z
        .array(
          z.record(
            z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
            z.string().max(1_000_000),
          ),
        )
        .max(100_000),
    ),
  })
  .strict();
const inventorySchema = z
  .array(
    z
      .object({
        source_path: z.string().max(4096),
        path: z.string().max(4096),
        size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        sha256: hash,
      })
      .strict(),
  )
  .max(100_000);
function text(row: SourceRow, name: string): string {
  if (!Object.hasOwn(row, name) || typeof row[name] !== "string")
    throw new LegacyDeltaInputError();
  return row[name];
}
function sourceId(row: SourceRow, name: string, zero = false): string {
  const value = text(row, name);
  if (zero && value === "0") return value;
  const parsed = legacyId.safeParse(value);
  if (!parsed.success) throw new LegacyDeltaInputError();
  return parsed.data;
}
function sourceInt(row: SourceRow, name: string): number {
  const value = text(row, name);
  if (
    !/^(?:0|[1-9][0-9]*)$/.test(value) ||
    !integer.safeParse(Number(value)).success
  )
    throw new LegacyDeltaInputError();
  return Number(value);
}
function sourceMoney(value: string): number {
  if (!decimal.safeParse(value).success) throw new LegacyDeltaInputError();
  const result = Math.round(Number(value) * 100);
  if (!integer.safeParse(result).success) throw new LegacyDeltaInputError();
  return result;
}
function sourceSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function sourceHtml(value: string): string {
  return cleanHtml(
    value.replace(
      /https?:\/\/(?:www\.)?innochem\.pl\/(wp-content\/uploads\/|sklep\/img\/)/g,
      "/media/$1",
    ),
  );
}
function uniqueSourceRows(
  rows: SourceRow[],
  names: string[],
): Map<string, SourceRow> {
  const result = new Map<string, SourceRow>();
  for (const row of rows) {
    const id = names.map((name) => sourceId(row, name)).join(":");
    if (result.has(id)) throw new LegacyDeltaInputError();
    result.set(id, row);
  }
  return result;
}

/** PostgreSQL's Europe/Warsaw interpretation: prefer standard/later UTC at DST ambiguity. */
export function legacyWarsawTimestamp(value: string): string | null {
  if (!value || value === "0000-00-00 00:00:00") return null;
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))
    throw new LegacyDeltaInputError();
  const iso = value.replace(" ", "T");
  const local = Date.parse(iso + "Z");
  if (
    !Number.isFinite(local) ||
    new Date(local).toISOString().slice(0, 19) !== iso
  )
    throw new LegacyDeltaInputError();
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const rendered = (time: number) => {
    const parts = Object.fromEntries(
      format
        .formatToParts(new Date(time))
        .map((part) => [part.type, part.value]),
    );
    return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  };
  const offsets = new Set(
    [-36, 0, 36].map((hours) => {
      const candidate = local + hours * 3_600_000;
      return Date.parse(rendered(candidate) + "Z") - candidate;
    }),
  );
  const candidates = [...offsets].map((offset) => local - offset);
  const exact = candidates.filter((candidate) => rendered(candidate) === iso);
  return new Date(
    Math.max(...(exact.length ? exact : candidates)),
  ).toISOString();
}

/** Converts extracted tables and media inventory without logging or returning clear-text fields. */
export function normalizeLegacyDeltaSource(
  raw: unknown,
  inventoryInput: unknown,
) {
  const parsed = sourceSchema.safeParse(raw),
    inventory = inventorySchema.safeParse(inventoryInput);
  if (!parsed.success || !inventory.success) throw new LegacyDeltaInputError();
  const t = parsed.data.tables;
  if (
    Object.keys(t).some((name) => !sourceTables.includes(name)) ||
    consumedTables.some((name) => !Object.hasOwn(t, name)) ||
    Object.values(t).reduce((sum, rows) => sum + rows.length, 0) > 100_000
  )
    throw new LegacyDeltaInputError();
  const by = (table: string, ...names: string[]) =>
    uniqueSourceRows(t[table], names);
  const languages = by("lang", "id_lang"),
    countries = by("country", "id_country");
  const plLanguages = [...languages.values()].filter(
    (row) => text(row, "iso_code") === "pl",
  );
  const plCountries = [...countries.values()].filter(
    (row) => text(row, "iso_code") === "PL",
  );
  if (plLanguages.length !== 1 || plCountries.length !== 1)
    throw new LegacyDeltaInputError();
  const language = plLanguages[0].id_lang,
    country = plCountries[0].id_country;
  const products = by("product", "id_product"),
    categories = by("category", "id_category");
  const productNames = by("product_lang", "id_product", "id_lang");
  const categoryNames = by("category_lang", "id_category", "id_lang");
  const customers = by("customer", "id_customer"),
    addresses = by("address", "id_address"),
    orders = by("orders", "id_order");
  const tax = by("tax", "id_tax"),
    currency = by("currency", "id_currency"),
    carriers = by("carrier", "id_carrier");
  const stateNames = by("order_state_lang", "id_order_state", "id_lang");
  by("image", "id_image");
  by("order_history", "id_order_history");
  by("order_detail", "id_order_detail");
  const images = new Map<string, z.infer<typeof inventorySchema>[number]>();
  for (const image of inventory.data) {
    if (
      images.has(image.source_path) ||
      !image.path.startsWith("/media/") ||
      image.path.includes("\\") ||
      image.path.split("/").includes("..")
    )
      throw new LegacyDeltaInputError();
    images.set(image.source_path, image);
  }
  const links = new Map<string, Set<string>>();
  for (const relation of t.category_product) {
    const product = sourceId(relation, "id_product"),
      category = sourceId(relation, "id_category");
    if (!products.has(product) || !categories.has(category))
      throw new LegacyDeltaInputError();
    const refs = links.get(product) || new Set<string>();
    if (refs.has(category)) throw new LegacyDeltaInputError();
    refs.add(category);
    links.set(product, refs);
  }
  const addressData = (row: SourceRow | undefined) =>
    row
      ? {
          firstName: text(row, "firstname"),
          lastName: text(row, "lastname"),
          company: text(row, "company"),
          street: [text(row, "address1"), text(row, "address2")]
            .filter(Boolean)
            .join(", "),
          postalCode: text(row, "postcode"),
          city: text(row, "city"),
          country:
            countries.get(sourceId(row, "id_country", true))?.iso_code || "",
          phone: text(row, "phone_mobile") || text(row, "phone"),
          nip: text(row, "vat_number"),
        }
      : {};
  const refId = (id: string) => ({ legacyId: id });
  const snapshot = {
    schemaVersion: 1,
    role: "source",
    categories: [] as unknown[],
    products: [] as unknown[],
    customers: [] as unknown[],
    addresses: [] as unknown[],
    orders: [] as unknown[],
    orderItems: [] as unknown[],
  };
  const exclusions = {
    detachedAddresses: 0,
    ordersWithoutCustomer: 0,
    historicalItemsWithoutProduct: 0,
    missingProductImages: 0,
    categoryParentsNotImported: 0,
    ordersWithoutInvoiceAddress: 0,
    ordersWithoutDeliveryAddress: 0,
  };
  for (const [id, c] of categories) {
    const name = categoryNames.get(`${id}:${language}`);
    if (!name) throw new LegacyDeltaInputError();
    const parent = sourceId(c, "id_parent", true);
    if (parent !== "0" && !categories.has(parent))
      exclusions.categoryParentsNotImported++;
    snapshot.categories.push({
      legacyId: id,
      fields: {
        slugHash: legacyDeltaHash(
          sourceSlug(text(name, "link_rewrite") || text(name, "name")),
        ),
        nameHash: legacyDeltaHash(text(name, "name")),
        descriptionHtmlHash: legacyDeltaHash(
          sourceHtml(text(name, "description")),
        ),
        parentRef: categories.has(parent) ? refId(parent) : null,
        visible: !["1", "10", "11"].includes(id),
        position: sourceInt(c, "position"),
      },
    });
  }
  for (const [id, p] of products) {
    const name = productNames.get(`${id}:${language}`);
    if (!name) throw new LegacyDeltaInputError();
    const taxGroup = sourceId(p, "id_tax_rules_group", true);
    const rules = t.tax_rule.filter(
      (rule) =>
        text(rule, "id_tax_rules_group") === taxGroup &&
        text(rule, "id_country") === country,
    );
    if (taxGroup !== "0" && rules.length !== 1)
      throw new LegacyDeltaInputError();
    const taxRate =
      taxGroup === "0" ? "0" : tax.get(sourceId(rules[0], "id_tax"))?.rate;
    if (taxRate === undefined || !rate.safeParse(taxRate).success)
      throw new LegacyDeltaInputError();
    const covers = t.image.filter(
      (image) =>
        text(image, "id_product") === id && text(image, "cover") === "1",
    );
    if (covers.length > 1) throw new LegacyDeltaInputError();
    const image = covers.length
      ? images.get(`sklep/img/p/${id}-${sourceId(covers[0], "id_image")}.jpg`)
      : undefined;
    if (!image) exclusions.missingProductImages++;
    const summary = plainText(text(name, "description_short"));
    const weight = text(p, "weight");
    if (!decimal.safeParse(weight).success) throw new LegacyDeltaInputError();
    snapshot.products.push({
      legacyId: id,
      reserved: 0,
      stockMovementCount: 0,
      fields: {
        slugHash: legacyDeltaHash(
          id === "16"
            ? "hps-5w30"
            : `${sourceSlug(text(name, "link_rewrite") || text(name, "name"))}-${id}`,
        ),
        skuHash: legacyDeltaHash(text(p, "reference")),
        nameHash: legacyDeltaHash(text(name, "name")),
        summaryHash: legacyDeltaHash(summary),
        descriptionHtmlHash: legacyDeltaHash(
          sourceHtml(text(name, "description")),
        ),
        price: { kind: "net", amount: text(p, "price"), taxRate },
        stock: sourceInt(p, "quantity"),
        status: ["41", "43", "44"].includes(id)
          ? "archived"
          : text(p, "active") === "1"
            ? "active"
            : "draft",
        saleMode: "retail",
        weightGrams: Math.round(Number(weight) * 1000),
        imagePathHash: legacyDeltaHash(image?.path || null),
        imageAltHash: legacyDeltaHash(text(name, "name")),
        metaTitleHash: legacyDeltaHash(
          text(name, "meta_title") || text(name, "name"),
        ),
        metaDescriptionHash: legacyDeltaHash(
          text(name, "meta_description") || summary.slice(0, 160),
        ),
        categoryRefs: [...(links.get(id) || [])].sort().map(refId),
      },
    });
  }
  for (const [id, c] of customers)
    snapshot.customers.push({
      legacyId: id,
      fields: {
        emailHash: legacyDeltaHash(text(c, "email").trim().toLowerCase()),
        firstNameHash: legacyDeltaHash(text(c, "firstname")),
        lastNameHash: legacyDeltaHash(text(c, "lastname")),
        sourceCreatedAtHash: legacyDeltaHash(
          legacyWarsawTimestamp(text(c, "date_add")),
        ),
      },
    });
  for (const [id, a] of addresses) {
    const customer = sourceId(a, "id_customer", true);
    if (!customers.has(customer)) {
      exclusions.detachedAddresses++;
      continue;
    }
    snapshot.addresses.push({
      legacyId: id,
      fields: {
        customerRef: refId(customer),
        labelHash: legacyDeltaHash(text(a, "alias")),
        dataHash: legacyDeltaHash(addressData(a)),
        archived: text(a, "deleted") === "1",
      },
    });
  }
  const itemTotals = new Map<string, number>();
  for (const item of t.order_detail) {
    const id = sourceId(item, "id_order_detail"),
      order = sourceId(item, "id_order"),
      product = sourceId(item, "product_id", true);
    if (!orders.has(order)) throw new LegacyDeltaInputError();
    const quantity = sourceInt(item, "product_quantity"),
      unit = legacyNetPriceToGrossCents(
        text(item, "product_price"),
        text(item, "tax_rate"),
      );
    const total = unit * quantity;
    itemTotals.set(order, (itemTotals.get(order) || 0) + total);
    if (!products.has(product)) exclusions.historicalItemsWithoutProduct++;
    snapshot.orderItems.push({
      legacyId: id,
      fields: {
        orderRef: refId(order),
        productRef: products.has(product) ? refId(product) : null,
        productNameHash: legacyDeltaHash(text(item, "product_name")),
        skuHash: legacyDeltaHash(text(item, "product_reference")),
        quantity,
        unitPrice: {
          kind: "net",
          amount: text(item, "product_price"),
          taxRate: text(item, "tax_rate"),
        },
        totalCents: total,
      },
    });
  }
  for (const history of t.order_history)
    if (
      !orders.has(sourceId(history, "id_order")) ||
      !legacyWarsawTimestamp(text(history, "date_add"))
    )
      throw new LegacyDeltaInputError();
  for (const [id, o] of orders) {
    if (
      Math.abs(
        (itemTotals.get(id) || 0) - sourceMoney(text(o, "total_products_wt")),
      ) > 1
    )
      throw new LegacyDeltaInputError();
    const customerId = sourceId(o, "id_customer", true),
      c = customers.get(customerId);
    if (!c) exclusions.ordersWithoutCustomer++;
    const created = legacyWarsawTimestamp(text(o, "date_add")),
      updated = legacyWarsawTimestamp(text(o, "date_upd"));
    if (!created || !updated) throw new LegacyDeltaInputError();
    const shipping = sourceMoney(text(o, "total_shipping")),
      total = sourceMoney(text(o, "total_paid"));
    const currentCurrency = currency.get(sourceId(o, "id_currency"));
    if (!currentCurrency) throw new LegacyDeltaInputError();
    const history = t.order_history
      .filter((entry) => entry.id_order === id)
      .sort(
        (a, b) =>
          text(a, "date_add").localeCompare(text(b, "date_add")) ||
          Number(a.id_order_history) - Number(b.id_order_history),
      );
    const last = history.at(-1),
      statusName = last
        ? stateNames.get(`${sourceId(last, "id_order_state")}:6`)?.name
        : "Archiwalne";
    const original = { ...o };
    delete original.secure_key;
    const email = c ? text(c, "email") : "";
    if (!addresses.has(sourceId(o, "id_address_invoice", true)))
      exclusions.ordersWithoutInvoiceAddress++;
    if (!addresses.has(sourceId(o, "id_address_delivery", true)))
      exclusions.ordersWithoutDeliveryAddress++;
    snapshot.orders.push({
      legacyId: id,
      reservationState: "none",
      fields: {
        customerRef: c ? refId(customerId) : null,
        emailHash: legacyDeltaHash(email),
        buyerHash: legacyDeltaHash({
          ...addressData(
            addresses.get(sourceId(o, "id_address_invoice", true)),
          ),
          email,
        }),
        shippingAddressHash: legacyDeltaHash(
          addressData(addresses.get(sourceId(o, "id_address_delivery", true))),
        ),
        status: "legacy",
        paymentMethodHash: legacyDeltaHash(text(o, "payment")),
        currency: text(currentCurrency, "iso_code"),
        subtotalCents: total - shipping,
        shippingCents: shipping,
        totalCents: total,
        shippingMethodHash: legacyDeltaHash(
          `legacy-${sourceId(o, "id_carrier", true)}`,
        ),
        shippingLabelHash: legacyDeltaHash(
          carriers.get(o.id_carrier)?.name || "Dostawa historyczna",
        ),
        trackingNumberHash: legacyDeltaHash(text(o, "shipping_number") || null),
        stockCommitted: true,
        termsVersionHash: legacyDeltaHash("legacy"),
        sourceDataHash: legacyDeltaHash({
          original,
          ...(statusName === undefined ? {} : { statusName }),
        }),
        createdAtHash: legacyDeltaHash(created),
        updatedAtHash: legacyDeltaHash(updated),
      },
    });
  }
  parseLegacyDeltaSnapshot(snapshot, "source");
  // Canonical prices remain in the documented external format for subsequent parsing.
  for (const entity of legacyDeltaEntities)
    snapshot[entity].sort((a, b) =>
      String((a as Reference).legacyId).localeCompare(
        String((b as Reference).legacyId),
      ),
    );
  return {
    snapshot,
    exclusions,
    ignoredTableCounts: Object.fromEntries(
      Object.entries(t)
        .filter(([name]) => !consumedTables.includes(name))
        .map(([name, rows]) => [name, rows.length]),
    ),
  };
}

export interface LegacyDeltaReadOnlyClient {
  /** Explicit ownership assertion: dedicated idle connection, never a Pool or active transaction. */
  dedicatedConnection: true;
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}
const exportColumns = {
  categories:
    "id::text,legacy_id,slug,name,description_html,parent_id::text,visible,position",
  products:
    "id::text,legacy_id,slug,sku,name,summary,description_html,price_cents,tax_rate::text,stock,reserved,status,sale_mode,weight_grams,image_path,image_alt,meta_title,meta_description",
  customers: "id::text,legacy_id,email,first_name,last_name,source_created_at",
  addresses: "id::text,legacy_id,customer_id::text,label,data,archived",
  orders:
    "id::text,legacy_id,customer_id::text,email,buyer,shipping_address,status,payment_method,currency,subtotal_cents,shipping_cents,total_cents,shipping_method,shipping_label,tracking_number,stock_committed,terms_version,source_data,created_at,updated_at,CASE WHEN stock_committed OR status <> 'pending_payment' THEN 'none' WHEN reservation_expires_at IS NULL OR reservation_expires_at > transaction_timestamp() OR EXISTS(SELECT 1 FROM payment_sessions ps WHERE ps.order_id=orders.id AND ps.state IN ('creating','open','processing')) THEN 'active' ELSE 'expired' END AS reservation_state",
  orderItems:
    "id::text,legacy_id,order_id::text,product_id::text,product_name,sku,quantity,unit_price_cents,tax_rate::text,total_cents",
};

/** Fixed SELECT statements inside a bounded read-only repeatable-read transaction. */
export async function exportLegacyDeltaTarget(
  client: LegacyDeltaReadOnlyClient,
) {
  if (client.dedicatedConnection !== true) throw new LegacyDeltaInputError();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    return await readLegacyDeltaTargetInTransaction({
      activeTransaction: true,
      query: (sql) => client.query(sql),
    });
  } finally {
    await client.query("ROLLBACK");
  }
}

/** Caller owns an active, bounded transaction and its locks; never starts or ends it. */
export async function readLegacyDeltaTargetInTransaction(client: {
  activeTransaction: true;
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}) {
  if (client.activeTransaction !== true) throw new LegacyDeltaInputError();
  const raw = {} as Record<LegacyDeltaEntity, Record<string, unknown>[]>;
  let rowCount = 0;
  for (const entity of legacyDeltaEntities) {
    const table = entity === "orderItems" ? "order_items" : entity;
    raw[entity] = (
      await client.query(
        `SELECT ${exportColumns[entity]} FROM ${table} ORDER BY id LIMIT 100001`,
      )
    ).rows;
    rowCount += raw[entity].length;
    if (rowCount > 100_000) throw new LegacyDeltaInputError();
  }
  const relations = (
    await client.query(
      "SELECT product_id::text,category_id::text FROM product_categories ORDER BY product_id,category_id LIMIT 100001",
    )
  ).rows;
  const movements = (
    await client.query(
      "SELECT product_id::text,count(*)::text AS movement_count FROM stock_movements GROUP BY product_id ORDER BY product_id LIMIT 100001",
    )
  ).rows;
  if (relations.length > 100_000 || movements.length > 100_000)
    throw new LegacyDeltaInputError();
  const stringColumns: Record<LegacyDeltaEntity, string[]> = {
    categories: ["slug", "name", "description_html"],
    products: [
      "slug",
      "sku",
      "name",
      "summary",
      "description_html",
      "tax_rate",
      "status",
      "sale_mode",
      "image_alt",
      "meta_title",
      "meta_description",
    ],
    customers: ["email", "first_name", "last_name"],
    addresses: ["label"],
    orders: [
      "email",
      "status",
      "payment_method",
      "currency",
      "shipping_method",
      "shipping_label",
      "terms_version",
      "reservation_state",
    ],
    orderItems: ["product_name", "sku", "tax_rate"],
  };
  const objectValue = (value: unknown) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
  for (const entity of legacyDeltaEntities)
    for (const row of raw[entity]) {
      if (
        stringColumns[entity].some((column) => typeof row[column] !== "string")
      )
        throw new LegacyDeltaInputError();
      if (
        entity === "products" &&
        row.image_path !== null &&
        typeof row.image_path !== "string"
      )
        throw new LegacyDeltaInputError();
      if (entity === "addresses" && !objectValue(row.data))
        throw new LegacyDeltaInputError();
      if (
        entity === "orders" &&
        (!objectValue(row.buyer) ||
          !objectValue(row.shipping_address) ||
          (row.source_data !== null && !objectValue(row.source_data)) ||
          (row.tracking_number !== null &&
            typeof row.tracking_number !== "string"))
      )
        throw new LegacyDeltaInputError();
    }
  const maps = new Map<LegacyDeltaEntity, Map<string, Reference>>();
  for (const entity of legacyDeltaEntities) {
    const map = new Map<string, Reference>();
    for (const row of raw[entity]) {
      if (!z.uuid().safeParse(row.id).success || map.has(String(row.id)))
        throw new LegacyDeltaInputError();
      const id = identity.safeParse({
        legacyId: row.legacy_id,
        targetId: row.id,
      });
      if (!id.success) throw new LegacyDeltaInputError();
      map.set(String(row.id), id.data);
    }
    maps.set(entity, map);
  }
  const reference = (
    entity: LegacyDeltaEntity,
    value: unknown,
  ): Reference | null => {
    if (value === null) return null;
    const found = maps.get(entity)!.get(String(value));
    if (!found) throw new LegacyDeltaInputError();
    return found.legacyId === null
      ? { ...found }
      : { legacyId: found.legacyId };
  };
  const links = new Map<string, Reference[]>(),
    movementCounts = new Map<string, number>();
  for (const relation of relations) {
    const product = reference("products", relation.product_id),
      category = reference("categories", relation.category_id);
    if (!product || !category) throw new LegacyDeltaInputError();
    const refs = links.get(String(relation.product_id)) || [];
    refs.push(category);
    links.set(String(relation.product_id), refs);
  }
  for (const movement of movements) {
    if (!reference("products", movement.product_id))
      throw new LegacyDeltaInputError();
    const count = String(movement.movement_count);
    if (
      !/^[1-9][0-9]*$/.test(count) ||
      !integer.safeParse(Number(count)).success ||
      movementCounts.has(String(movement.product_id))
    )
      throw new LegacyDeltaInputError();
    movementCounts.set(String(movement.product_id), Number(count));
  }
  const dateHash = (value: unknown) => {
    if (value === null) return legacyDeltaHash(null);
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
      throw new LegacyDeltaInputError();
    return legacyDeltaHash(value.toISOString());
  };
  const snapshot = {
    schemaVersion: 1,
    role: "storefront",
    categories: [] as unknown[],
    products: [] as unknown[],
    customers: [] as unknown[],
    addresses: [] as unknown[],
    orders: [] as unknown[],
    orderItems: [] as unknown[],
  };
  for (const row of raw.categories)
    snapshot.categories.push({
      ...maps.get("categories")!.get(String(row.id)),
      fields: {
        slugHash: legacyDeltaHash(row.slug),
        nameHash: legacyDeltaHash(row.name),
        descriptionHtmlHash: legacyDeltaHash(row.description_html),
        parentRef: reference("categories", row.parent_id),
        visible: row.visible,
        position: row.position,
      },
    });
  for (const row of raw.products)
    snapshot.products.push({
      ...maps.get("products")!.get(String(row.id)),
      reserved: row.reserved,
      stockMovementCount: movementCounts.get(String(row.id)) || 0,
      fields: {
        slugHash: legacyDeltaHash(row.slug),
        skuHash: legacyDeltaHash(row.sku),
        nameHash: legacyDeltaHash(row.name),
        summaryHash: legacyDeltaHash(row.summary),
        descriptionHtmlHash: legacyDeltaHash(row.description_html),
        price: {
          kind: "gross_cents",
          amount: row.price_cents,
          taxRate: row.tax_rate,
        },
        stock: row.stock,
        status: row.status,
        saleMode: row.sale_mode,
        weightGrams: row.weight_grams,
        imagePathHash: legacyDeltaHash(row.image_path),
        imageAltHash: legacyDeltaHash(row.image_alt),
        metaTitleHash: legacyDeltaHash(row.meta_title),
        metaDescriptionHash: legacyDeltaHash(row.meta_description),
        categoryRefs: links.get(String(row.id)) || [],
      },
    });
  for (const row of raw.customers)
    snapshot.customers.push({
      ...maps.get("customers")!.get(String(row.id)),
      fields: {
        emailHash: legacyDeltaHash(row.email),
        firstNameHash: legacyDeltaHash(row.first_name),
        lastNameHash: legacyDeltaHash(row.last_name),
        sourceCreatedAtHash: dateHash(row.source_created_at),
      },
    });
  for (const row of raw.addresses)
    snapshot.addresses.push({
      ...maps.get("addresses")!.get(String(row.id)),
      fields: {
        customerRef: reference("customers", row.customer_id),
        labelHash: legacyDeltaHash(row.label),
        dataHash: legacyDeltaHash(row.data),
        archived: row.archived,
      },
    });
  for (const row of raw.orders)
    snapshot.orders.push({
      ...maps.get("orders")!.get(String(row.id)),
      reservationState: row.reservation_state,
      fields: {
        customerRef: reference("customers", row.customer_id),
        emailHash: legacyDeltaHash(row.email),
        buyerHash: legacyDeltaHash(row.buyer),
        shippingAddressHash: legacyDeltaHash(row.shipping_address),
        status: row.status,
        paymentMethodHash: legacyDeltaHash(row.payment_method),
        currency: row.currency,
        subtotalCents: row.subtotal_cents,
        shippingCents: row.shipping_cents,
        totalCents: row.total_cents,
        shippingMethodHash: legacyDeltaHash(row.shipping_method),
        shippingLabelHash: legacyDeltaHash(row.shipping_label),
        trackingNumberHash: legacyDeltaHash(row.tracking_number),
        stockCommitted: row.stock_committed,
        termsVersionHash: legacyDeltaHash(row.terms_version),
        sourceDataHash: legacyDeltaHash(row.source_data),
        createdAtHash: dateHash(row.created_at),
        updatedAtHash: dateHash(row.updated_at),
      },
    });
  for (const row of raw.orderItems)
    snapshot.orderItems.push({
      ...maps.get("orderItems")!.get(String(row.id)),
      fields: {
        orderRef: reference("orders", row.order_id),
        productRef: reference("products", row.product_id),
        productNameHash: legacyDeltaHash(row.product_name),
        skuHash: legacyDeltaHash(row.sku),
        quantity: row.quantity,
        unitPrice: {
          kind: "gross_cents",
          amount: row.unit_price_cents,
          taxRate: row.tax_rate,
        },
        totalCents: row.total_cents,
      },
    });
  parseLegacyDeltaSnapshot(snapshot, "storefront");
  return snapshot;
}
