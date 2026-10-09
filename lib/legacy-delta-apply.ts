import { z } from "zod";
import {
  compareLegacyDelta,
  legacyDeltaHash,
  LegacyDeltaInputError,
  parseLegacyDeltaSnapshot,
  readLegacyDeltaTargetInTransaction,
} from "./legacy-delta";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().min(0).max(2_147_483_647);
const version = z.number().int().positive().max(2_147_483_646);
const databaseName = z.string().regex(/^innochem(?:_[a-z0-9_]+)?$/);
const provenanceSchema = z
  .object({
    schemaVersion: z.literal(1),
    baseline: z
      .object({
        snapshotHash: hash,
        archiveHash: hash,
        mediaInventoryHash: hash,
        importProtocolHash: hash,
      })
      .strict(),
    final: z
      .object({
        snapshotHash: hash,
        archiveHash: hash,
        mediaInventoryHash: hash,
        freezeProtocolHash: hash,
      })
      .strict(),
    target: z
      .object({
        snapshotHash: hash,
        database: databaseName,
        backupReceiptHash: hash,
      })
      .strict(),
  })
  .strict();
const supported = {
  categories: ["visible", "position"],
  products: [
    "priceCents",
    "taxRateBasisPoints",
    "stock",
    "status",
    "saleMode",
    "weightGrams",
  ],
} as const;
const valuesSchema = z
  .object({
    visible: z.boolean().optional(),
    position: integer.optional(),
    priceCents: integer.optional(),
    taxRateBasisPoints: integer.max(10_000).optional(),
    stock: integer.optional(),
    status: z.enum(["draft", "active", "archived"]).optional(),
    saleMode: z.enum(["retail", "inquiry"]).optional(),
    weightGrams: integer.optional(),
  })
  .strict();
const operationSchema = z
  .object({
    entity: z.enum(["categories", "products"]),
    legacyId: z.string().regex(/^[1-9][0-9]*$/),
    targetId: z.uuid(),
    version,
    currentRowHash: hash,
    fields: z.array(z.string()).min(1),
    values: valuesSchema,
  })
  .strict();
const blockerSchema = z
  .object({
    entity: z.string(),
    legacyId: z.string().nullable(),
    reason: z.string(),
  })
  .strict();
const planSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("catalog-only-delta"),
    fullOverwriteAllowed: z.literal(false),
    generatedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    database: databaseName,
    schemaHash: hash,
    provenance: provenanceSchema,
    snapshotHashes: z
      .object({ baseline: hash, final: hash, target: hash })
      .strict(),
    operations: z.array(operationSchema).max(5_000),
    blockers: z.array(blockerSchema).max(100_000),
    applyAllowed: z.boolean(),
    planHash: hash,
  })
  .strict();
export type LegacyCatalogDeltaPlan = z.infer<typeof planSchema>;
export type LegacyDeltaProvenance = z.infer<typeof provenanceSchema>;
export type LegacyCatalogDeltaInputs = {
  baseline: unknown;
  final: unknown;
  target: unknown;
  provenance: unknown;
};
export type LegacyCatalogVersion = {
  entity: "categories" | "products";
  legacyId: number;
  targetId: string;
  version: number;
};
export interface LegacyCatalogDeltaClient {
  /** Dedicated idle connection, not an app Pool or someone else's transaction. */
  dedicatedConnection: true;
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

/** PostgreSQL 17, clean schema from the 17 checked migrations; unknown DDL fails closed. */
export const legacyCatalogDeltaSchemaHash =
  "83d1c363332b9f1805514a3c1bd7ea6f315e25b5268b95de6b0f1e9f64d2c851";
export const legacyCatalogDeltaSchemaSql = `
SELECT jsonb_build_object(
  'relations', (SELECT jsonb_agg(jsonb_build_array(t.relname,t.relkind,t.relpersistence,t.relrowsecurity,t.relforcerowsecurity,t.relispartition) ORDER BY t.relname)
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'
    AND t.relname IN ('categories','products','product_categories','customers','addresses','orders','order_items','stock_movements','payment_sessions','price_history','import_runs','settings','schema_migrations')),
  'inheritance', (SELECT COALESCE(jsonb_agg(jsonb_build_array(pn.nspname,p.relname,cn.nspname,c.relname) ORDER BY pn.nspname,p.relname,cn.nspname,c.relname),'[]'::jsonb)
    FROM pg_inherits i JOIN pg_class p ON p.oid=i.inhparent JOIN pg_namespace pn ON pn.oid=p.relnamespace
    JOIN pg_class c ON c.oid=i.inhrelid JOIN pg_namespace cn ON cn.oid=c.relnamespace WHERE pn.nspname='public'
    AND p.relname IN ('categories','products','product_categories','customers','addresses','orders','order_items','stock_movements','payment_sessions','price_history','import_runs','settings','schema_migrations')),
  'rules', (SELECT COALESCE(jsonb_agg(jsonb_build_array(t.relname,r.rulename,pg_get_ruledef(r.oid,true)) ORDER BY t.relname,r.rulename),'[]'::jsonb)
    FROM pg_rewrite r JOIN pg_class t ON t.oid=r.ev_class JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'
    AND t.relname IN ('categories','products','product_categories','customers','addresses','orders','order_items','stock_movements','payment_sessions','price_history','import_runs','settings','schema_migrations')),
  'columns', (SELECT jsonb_agg(jsonb_build_array(c.table_name,c.column_name,c.data_type,c.udt_name,c.is_nullable,c.column_default,c.is_identity,c.identity_generation) ORDER BY c.table_name,c.ordinal_position)
    FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name IN ('categories','products','product_categories','customers','addresses','orders','order_items','stock_movements','payment_sessions','price_history','import_runs','settings','schema_migrations')),
  'constraints', (SELECT jsonb_agg(jsonb_build_array(t.relname,c.conname,pg_get_constraintdef(c.oid,true)) ORDER BY t.relname,c.conname)
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname IN ('categories','products','product_categories','customers','addresses','orders','order_items','stock_movements','payment_sessions','price_history','import_runs','settings','schema_migrations')),
  'triggers', (SELECT COALESCE(jsonb_agg(jsonb_build_array(t.relname,g.tgname,pg_get_triggerdef(g.oid,true)) ORDER BY t.relname,g.tgname),'[]'::jsonb)
    FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE NOT g.tgisinternal AND n.nspname='public'
    AND t.relname IN ('categories','products','product_categories','customers','addresses','orders','order_items','stock_movements','payment_sessions','price_history','import_runs','settings','schema_migrations'))
) AS schema`;
const lockSql =
  "LOCK TABLE public.categories,public.products,public.product_categories,public.customers,public.addresses,public.orders,public.order_items,public.stock_movements,public.payment_sessions,public.price_history,public.import_runs,public.schema_migrations,public.settings IN SHARE ROW EXCLUSIVE MODE";
const versionsSql =
  "SELECT 'categories'::text AS entity,legacy_id,id::text AS target_id,version FROM public.categories WHERE legacy_id IS NOT NULL UNION ALL SELECT 'products',legacy_id,id::text,version FROM public.products WHERE legacy_id IS NOT NULL ORDER BY entity,legacy_id";

function fail(): never {
  throw new LegacyDeltaInputError();
}
function parseProvenance(
  value: unknown,
  inputs: LegacyCatalogDeltaInputs,
  database: string,
) {
  const result = provenanceSchema.safeParse(value);
  if (!result.success) fail();
  const provenance = result.data;
  if (
    provenance.target.database !== database ||
    provenance.baseline.snapshotHash !== legacyDeltaHash(inputs.baseline) ||
    provenance.final.snapshotHash !== legacyDeltaHash(inputs.final) ||
    provenance.target.snapshotHash !== legacyDeltaHash(inputs.target)
  )
    fail();
  return provenance;
}
function withoutHash(plan: LegacyCatalogDeltaPlan) {
  const { planHash: _ignored, ...rest } = plan;
  return rest;
}
function rowKey(entity: string, legacyId: string | number) {
  return `${entity}:${legacyId}`;
}

/** Pure planner. Values are public catalog scalars; text hashes never become SQL values. */
export function planLegacyCatalogDelta(
  inputs: LegacyCatalogDeltaInputs,
  binding: {
    database: string;
    schemaHash: string;
    versions: LegacyCatalogVersion[];
    generatedAt?: string;
  },
): LegacyCatalogDeltaPlan {
  if (
    !databaseName.safeParse(binding.database).success ||
    binding.schemaHash !== legacyCatalogDeltaSchemaHash
  )
    fail();
  const provenance = parseProvenance(
    inputs.provenance,
    inputs,
    binding.database,
  );
  const report = compareLegacyDelta(
    inputs.baseline,
    inputs.final,
    inputs.target,
  );
  const final = parseLegacyDeltaSnapshot(inputs.final, "source"),
    target = parseLegacyDeltaSnapshot(inputs.target, "storefront");
  const versions = new Map<string, LegacyCatalogVersion>();
  for (const item of binding.versions) {
    if (
      !(item.entity in supported) ||
      !version.safeParse(item.version).success ||
      !z.uuid().safeParse(item.targetId).success ||
      !Number.isSafeInteger(item.legacyId) ||
      item.legacyId < 1 ||
      versions.has(rowKey(item.entity, item.legacyId))
    )
      fail();
    versions.set(rowKey(item.entity, item.legacyId), item);
  }
  const operations: LegacyCatalogDeltaPlan["operations"] = [],
    blockers: LegacyCatalogDeltaPlan["blockers"] = [];
  for (const change of report.changes) {
    if (
      [
        "target_only",
        "target_create",
        "target_delete",
        "same_change",
        "same_create",
      ].includes(change.classification)
    )
      continue;
    const block = (reason: string) =>
      blockers.push({
        entity: change.entity,
        legacyId: change.legacyId,
        reason,
      });
    if (!["source_only", "parallel_changes"].includes(change.classification)) {
      block(`unsupported_${change.classification}`);
      continue;
    }
    if (!(change.entity in supported) || change.legacyId === null) {
      block("unsupported_entity_or_creation");
      continue;
    }
    const entity = change.entity as "categories" | "products";
    const fields = change.sourceChangedFields.filter(
      (name) => !change.targetChangedFields.includes(name),
    );
    if (
      fields.some(
        (name) => !(supported[entity] as readonly string[]).includes(name),
      )
    ) {
      block("unsupported_field_requires_raw_payload_review");
      continue;
    }
    if (change.reasons.length) {
      for (const reason of change.reasons) block(reason);
      continue;
    }
    if (!fields.length) continue;
    const sourceRow = final[entity].find(
        (row) => row.legacyId === change.legacyId,
      )!,
      current = target[entity].find((row) => row.legacyId === change.legacyId)!;
    const bound = versions.get(rowKey(entity, change.legacyId));
    if (!bound || current.targetId !== bound.targetId) {
      block("missing_target_identity_or_version");
      continue;
    }
    const values = Object.fromEntries(
      fields.map((name) => [name, sourceRow.fields[name]]),
    );
    if (entity === "products") {
      if (
        current.reserved! > 0 &&
        fields.some((field) => ["stock", "status", "saleMode"].includes(field))
      ) {
        block("reserved_product_inventory_state_requires_review");
        continue;
      }
      const effective = { ...current.fields, ...values };
      if (
        (effective.status === "active" &&
          effective.saleMode === "retail" &&
          Number(effective.priceCents) <= 0) ||
        Number(effective.stock) < current.reserved!
      ) {
        block("unsafe_effective_product_state");
        continue;
      }
    }
    operations.push({
      entity,
      legacyId: change.legacyId,
      targetId: bound.targetId,
      version: bound.version,
      currentRowHash: legacyDeltaHash(current),
      fields,
      values,
    });
  }
  const generatedAt = binding.generatedAt || new Date().toISOString();
  if (!z.iso.datetime().safeParse(generatedAt).success) fail();
  const core = {
    schemaVersion: 1 as const,
    mode: "catalog-only-delta" as const,
    fullOverwriteAllowed: false as const,
    generatedAt,
    expiresAt: new Date(Date.parse(generatedAt) + 30 * 60 * 1000).toISOString(),
    database: binding.database,
    schemaHash: binding.schemaHash,
    provenance,
    snapshotHashes: report.snapshotHashes,
    operations,
    blockers,
    applyAllowed: blockers.length === 0,
  };
  return planSchema.parse({ ...core, planHash: legacyDeltaHash(core) });
}

async function transactionSetup(
  client: LegacyCatalogDeltaClient,
  writable: boolean,
) {
  if (client.dedicatedConnection !== true) fail();
  await client.query(
    writable
      ? "BEGIN ISOLATION LEVEL READ COMMITTED"
      : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  try {
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL search_path = pg_catalog, public");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
async function readBinding(
  client: LegacyCatalogDeltaClient,
  database: string,
  expectedMigrations: { name: string; checksum: string }[],
) {
  if (
    (await client.query("SELECT current_database() AS database")).rows[0]
      ?.database !== database
  )
    fail();
  const schema = (await client.query(legacyCatalogDeltaSchemaSql)).rows[0]
    ?.schema;
  const schemaHash = legacyDeltaHash(schema);
  if (schemaHash !== legacyCatalogDeltaSchemaHash) fail();
  const migrations = (
    await client.query(
      "SELECT name,checksum FROM public.schema_migrations ORDER BY name",
    )
  ).rows;
  if (
    !expectedMigrations.length ||
    legacyDeltaHash(migrations) !== legacyDeltaHash(expectedMigrations)
  )
    fail();
  const versions = (await client.query(versionsSql)).rows.map((row) => ({
    entity: row.entity as "categories" | "products",
    legacyId: row.legacy_id as number,
    targetId: row.target_id as string,
    version: row.version as number,
  }));
  const target = await readLegacyDeltaTargetInTransaction({
    activeTransaction: true,
    query: (sql) => client.query(sql),
  });
  return { database, schemaHash, versions, target };
}
export async function dryRunLegacyCatalogDelta(
  client: LegacyCatalogDeltaClient,
  inputs: LegacyCatalogDeltaInputs,
  binding: {
    database: string;
    expectedMigrations: { name: string; checksum: string }[];
  },
) {
  await transactionSetup(client, false);
  try {
    const live = await readBinding(
      client,
      binding.database,
      binding.expectedMigrations,
    );
    if (legacyDeltaHash(live.target) !== legacyDeltaHash(inputs.target)) fail();
    return planLegacyCatalogDelta(inputs, live);
  } finally {
    await client.query("ROLLBACK");
  }
}

const sqlColumns = {
  visible: "visible",
  position: "position",
  priceCents: "price_cents",
  taxRateBasisPoints: "tax_rate",
  stock: "stock",
  status: "status",
  saleMode: "sale_mode",
  weightGrams: "weight_grams",
};
/** Explicit apply only: recompute the full plan while locks prevent target writes. */
export async function applyLegacyCatalogDelta(
  client: LegacyCatalogDeltaClient,
  inputs: LegacyCatalogDeltaInputs,
  planInput: unknown,
  binding: {
    database: string;
    expectedMigrations: { name: string; checksum: string }[];
    confirmPlanHash: string;
    now?: Date;
  },
) {
  const parsed = planSchema.safeParse(planInput);
  if (!parsed.success) fail();
  const plan = parsed.data,
    now = (binding.now || new Date()).getTime();
  if (
    !Number.isFinite(now) ||
    plan.database !== binding.database ||
    binding.confirmPlanHash !== plan.planHash ||
    legacyDeltaHash(withoutHash(plan)) !== plan.planHash ||
    !plan.applyAllowed ||
    plan.blockers.length ||
    Date.parse(plan.generatedAt) > now ||
    Date.parse(plan.expiresAt) <= now
  )
    fail();
  await transactionSetup(client, true);
  const deadline = Date.now() + 30_000;
  try {
    // Keep the importers' advisory -> table order. READ COMMITTED deliberately
    // refreshes the snapshot after the table locks, including intervening commits.
    await client.query("SELECT pg_advisory_xact_lock(842615913)");
    await client.query("SELECT pg_advisory_xact_lock(842615914)");
    await client.query(lockSql);
    const live = await readBinding(
      client,
      binding.database,
      binding.expectedMigrations,
    );
    const store = (
      await client.query("SELECT value FROM public.settings WHERE key='store'")
    ).rows[0]?.value as Record<string, unknown> | undefined;
    if (!store || store.checkoutEnabled !== false) fail();
    if (legacyDeltaHash(live.target) !== legacyDeltaHash(inputs.target)) fail();
    const recomputed = planLegacyCatalogDelta(inputs, {
      ...live,
      generatedAt: plan.generatedAt,
    });
    if (recomputed.planHash !== plan.planHash || !recomputed.applyAllowed)
      fail();
    if (
      (
        await client.query(
          "SELECT id FROM public.import_runs WHERE mode='catalog-delta-v1' AND source_hash=$1 LIMIT 1",
          [plan.planHash],
        )
      ).rows.length
    )
      fail();
    for (const operation of recomputed.operations) {
      if (Date.now() >= deadline || Date.parse(plan.expiresAt) <= Date.now())
        fail();
      const fields = operation.fields;
      // Names originate solely from the checked allowlist; values always use SQL parameters.
      const assignments = fields.map(
        (field, index) =>
          `${sqlColumns[field as keyof typeof sqlColumns]}=$${index + 1}`,
      );
      const values: unknown[] = fields.map((field) =>
        field === "taxRateBasisPoints"
          ? Number(operation.values.taxRateBasisPoints) / 100
          : operation.values[field as keyof typeof operation.values],
      );
      const index = values.length;
      values.push(
        operation.targetId,
        Number(operation.legacyId),
        operation.version,
      );
      const result = await client.query(
        `UPDATE public.${operation.entity} SET ${assignments.join(",")},version=version+1${operation.entity === "products" ? ",updated_at=now()" : ""} WHERE id=$${index + 1} AND legacy_id=$${index + 2} AND version=$${index + 3} RETURNING id`,
        values,
      );
      if (result.rows.length !== 1) fail();
      if (operation.entity === "products" && fields.includes("priceCents"))
        await client.query(
          "INSERT INTO public.price_history(product_id,price_cents) VALUES($1,$2)",
          [operation.targetId, operation.values.priceCents],
        );
    }
    await client.query(
      "INSERT INTO public.import_runs(source_hash,mode,report) VALUES($1,'catalog-delta-v1',$2)",
      [
        plan.planHash,
        JSON.stringify({
          schemaVersion: 1,
          planHash: plan.planHash,
          snapshotHashes: plan.snapshotHashes,
          provenanceHash: legacyDeltaHash(plan.provenance),
          operationCount: plan.operations.length,
        }),
      ],
    );
    if (Date.now() >= deadline || Date.parse(plan.expiresAt) <= Date.now())
      fail();
    await client.query("COMMIT");
    return {
      applied: true,
      operations: plan.operations.length,
      planHash: plan.planHash,
      fullOverwriteAllowed: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
