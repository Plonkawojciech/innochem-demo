import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  readFile,
  mkdtemp,
  writeFile,
  stat,
  symlink,
  chmod,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Client } from "pg";
import {
  legacyDeltaHash,
  exportLegacyDeltaTarget,
  LegacyDeltaInputError,
} from "../lib/legacy-delta";
import {
  planLegacyCatalogDelta,
  dryRunLegacyCatalogDelta,
  applyLegacyCatalogDelta,
  legacyCatalogDeltaSchemaHash,
  type LegacyCatalogDeltaInputs,
  type LegacyCatalogDeltaClient,
} from "../lib/legacy-delta-apply";
import {
  legacyCatalogDeltaEnvironment,
  legacyCatalogDeltaCommand,
} from "../scripts/apply-legacy-catalog-delta";
import { requiredMigrations } from "../lib/server/migrations-manifest";

const database = "innochem_test_delta_apply_fixture";
const categoryId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const h = legacyDeltaHash;
function source() {
  return {
    schemaVersion: 1,
    role: "source",
    categories: [
      {
        legacyId: 1,
        fields: {
          slugHash: h("synthetic-oil"),
          nameHash: h("Synthetic oil"),
          descriptionHtmlHash: h(""),
          parentRef: null,
          visible: true,
          position: 0,
        },
      },
    ],
    products: [
      {
        legacyId: 1,
        reserved: 0,
        stockMovementCount: 0,
        fields: {
          slugHash: h("synthetic-oil-1"),
          skuHash: h("SYNTHETIC"),
          nameHash: h("Synthetic product"),
          summaryHash: h(""),
          descriptionHtmlHash: h(""),
          price: { kind: "gross_cents", amount: 1230, taxRate: "23.00" },
          stock: 10,
          status: "active",
          saleMode: "retail",
          weightGrams: 1000,
          imagePathHash: h(null),
          imageAltHash: h(""),
          metaTitleHash: h(""),
          metaDescriptionHash: h(""),
          categoryRefs: [],
        },
      },
    ],
    customers: [],
    addresses: [],
    orders: [],
    orderItems: [],
  };
}
function fixture() {
  const baseline = source(),
    final = structuredClone(baseline),
    target = { ...structuredClone(baseline), role: "storefront" };
  Object.assign(target.categories[0], { targetId: categoryId });
  Object.assign(target.products[0], { targetId: productId });
  final.products[0].fields.stock = 11;
  return inputsFor(baseline, final, target, database);
}
function inputsFor(
  baseline: unknown,
  final: unknown,
  target: unknown,
  db: string,
): LegacyCatalogDeltaInputs {
  return {
    baseline,
    final,
    target,
    provenance: {
      schemaVersion: 1,
      baseline: {
        snapshotHash: h(baseline),
        archiveHash: h("synthetic-baseline-archive"),
        mediaInventoryHash: h("synthetic-baseline-inventory"),
        importProtocolHash: h("synthetic-import-protocol"),
      },
      final: {
        snapshotHash: h(final),
        archiveHash: h("synthetic-final-archive"),
        mediaInventoryHash: h("synthetic-final-inventory"),
        freezeProtocolHash: h("synthetic-freeze"),
      },
      target: {
        snapshotHash: h(target),
        database: db,
        backupReceiptHash: h("synthetic-backup-receipt"),
      },
    },
  };
}
const versions = [
  {
    entity: "categories" as const,
    legacyId: 1,
    targetId: categoryId,
    version: 1,
  },
  { entity: "products" as const, legacyId: 1, targetId: productId, version: 1 },
];
const binding = {
  database,
  schemaHash: legacyCatalogDeltaSchemaHash,
  versions,
  generatedAt: "2026-10-09T08:00:00.000Z",
};

test("catalog planner binds exact provenance, identities, versions and public scalar operations without mutation", () => {
  const inputs = fixture(),
    before = JSON.stringify(inputs),
    plan = planLegacyCatalogDelta(inputs, binding);
  assert.equal(plan.applyAllowed, true);
  assert.equal(plan.fullOverwriteAllowed, false);
  assert.equal(plan.operations.length, 1);
  assert.deepEqual(plan.operations[0].values, { stock: 11 });
  assert.equal(plan.operations[0].targetId, productId);
  assert.equal(plan.operations[0].version, 1);
  assert.equal(JSON.stringify(inputs), before);
  assert.equal(plan.expiresAt, "2026-10-09T08:30:00.000Z");
  assert.equal(JSON.stringify(plan).includes("Synthetic product"), false);
});
test("independent target edits are preserved and identical changes need no write", () => {
  const baseline = source(),
    final = structuredClone(baseline),
    target = { ...structuredClone(baseline), role: "storefront" };
  Object.assign(target.categories[0], { targetId: categoryId });
  Object.assign(target.products[0], { targetId: productId });
  final.products[0].fields.stock = 11;
  target.products[0].fields.nameHash = h("intentional current title");
  let plan = planLegacyCatalogDelta(
    inputsFor(baseline, final, target, database),
    binding,
  );
  assert.equal(plan.applyAllowed, true);
  assert.deepEqual(plan.operations[0].fields, ["stock"]);
  target.products[0].fields.stock = 11;
  plan = planLegacyCatalogDelta(
    inputsFor(baseline, final, target, database),
    binding,
  );
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.applyAllowed, true);
});
test("any source conflict, creation, delete or hash-only edit blocks the whole plan", () => {
  for (const kind of [
    "conflict",
    "create",
    "delete",
    "hash",
    "missingIdentity",
    "missingVersion",
  ]) {
    const baseline = source(),
      final = structuredClone(baseline),
      target = { ...structuredClone(baseline), role: "storefront" };
    Object.assign(target.categories[0], { targetId: categoryId });
    Object.assign(target.products[0], { targetId: productId });
    final.products[0].fields.stock = 11;
    if (kind === "conflict") target.products[0].fields.stock = 12;
    if (kind === "create")
      final.products.push({
        ...structuredClone(final.products[0]),
        legacyId: 2,
      });
    if (kind === "delete") final.products = [];
    if (kind === "hash")
      final.products[0].fields.nameHash = h(
        "new text cannot be recovered from a hash",
      );
    if (kind === "missingIdentity")
      delete (target.products[0] as { targetId?: string }).targetId;
    const plan = planLegacyCatalogDelta(
      inputsFor(baseline, final, target, database),
      { ...binding, versions: kind === "missingVersion" ? [] : versions },
    );
    assert.equal(plan.applyAllowed, false, kind);
    assert.ok(plan.blockers.length, kind);
  }
});
test("reservations, stock movements and unsafe active retail price block affected catalog updates", () => {
  for (const kind of ["reserved", "movement", "zeroPrice"]) {
    const baseline = source(),
      final = structuredClone(baseline),
      target = { ...structuredClone(baseline), role: "storefront" };
    Object.assign(target.categories[0], { targetId: categoryId });
    Object.assign(target.products[0], { targetId: productId });
    final.products[0].fields.stock = 11;
    if (kind === "reserved") target.products[0].reserved = 1;
    if (kind === "movement") target.products[0].stockMovementCount = 1;
    if (kind === "zeroPrice") final.products[0].fields.price.amount = 0;
    assert.equal(
      planLegacyCatalogDelta(
        inputsFor(baseline, final, target, database),
        binding,
      ).applyAllowed,
      false,
      kind,
    );
  }
});
test("missing or mismatched provenance and unknown schema are rejected before a plan exists", () => {
  const input = fixture();
  assert.throws(
    () => planLegacyCatalogDelta({ ...input, provenance: {} }, binding),
    LegacyDeltaInputError,
  );
  assert.throws(
    () => planLegacyCatalogDelta({ ...input, final: source() }, binding),
    LegacyDeltaInputError,
  );
  assert.throws(
    () =>
      planLegacyCatalogDelta(input, {
        ...binding,
        schemaHash: h("unknown DDL"),
      }),
    LegacyDeltaInputError,
  );
});

test("changing reserved product status or sale mode requires separate inventory review", () => {
  for (const field of ["status", "saleMode"] as const) {
    const baseline = source(),
      final = structuredClone(baseline),
      target = { ...structuredClone(baseline), role: "storefront" };
    Object.assign(target.categories[0], { targetId: categoryId });
    Object.assign(target.products[0], { targetId: productId });
    target.products[0].reserved = 1;
    final.products[0].fields[field] = field === "status" ? "draft" : "inquiry";
    const plan = planLegacyCatalogDelta(
      inputsFor(baseline, final, target, database),
      binding,
    );
    assert.equal(plan.applyAllowed, false);
    assert.ok(
      plan.blockers.some(
        (row) =>
          row.reason === "reserved_product_inventory_state_requires_review",
      ),
    );
  }
});
test("CLI defaults to read-only and requires explicit database and frozen integration guards for apply", () => {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PGHOST: "/tmp/innochem-postgres",
    PGPORT: "55439",
    PGUSER: "wojciechplonka",
    PGDATABASE: database,
    INNOCHEM_DELTA_EXPORT_READ_ONLY: "1",
  };
  assert.equal(
    legacyCatalogDeltaEnvironment(env, database, false).apply,
    false,
  );
  assert.throws(
    () => legacyCatalogDeltaEnvironment(env, database, true),
    LegacyDeltaInputError,
  );
  const frozen = {
    ...env,
    INNOCHEM_DELTA_CATALOG_APPLY: "1",
    INNOCHEM_DELTA_FREEZE_CONFIRMED: "1",
    PAYMENTS_ENABLED: "false",
    MAIL_DELIVERY_ENABLED: "false",
    STORE_WORKER_ENABLED: "false",
  };
  assert.equal(
    legacyCatalogDeltaEnvironment(frozen, database, true).apply,
    true,
  );
  for (const key of [
    "PGDATABASE",
    "PAYMENTS_ENABLED",
    "MAIL_DELIVERY_ENABLED",
    "STORE_WORKER_ENABLED",
    "INNOCHEM_DELTA_FREEZE_CONFIRMED",
  ])
    assert.throws(
      () =>
        legacyCatalogDeltaEnvironment(
          { ...frozen, [key]: "incorrect" },
          database,
          true,
        ),
      LegacyDeltaInputError,
    );
  assert.throws(
    () =>
      legacyCatalogDeltaEnvironment(
        { ...env, PGOPTIONS: "-c search_path=other" },
        database,
        false,
      ),
    LegacyDeltaInputError,
  );
});
test("expired or tampered plan never opens a transaction", async () => {
  const input = fixture(),
    plan = planLegacyCatalogDelta(input, binding),
    calls: string[] = [];
  const client: LegacyCatalogDeltaClient = {
    dedicatedConnection: true,
    query: async (sql) => {
      calls.push(sql);
      return { rows: [] };
    },
  };
  await assert.rejects(
    applyLegacyCatalogDelta(client, input, plan, {
      database,
      expectedMigrations: [],
      confirmPlanHash: plan.planHash,
      now: new Date("2026-10-09T08:30:00Z"),
    }),
    LegacyDeltaInputError,
  );
  await assert.rejects(
    applyLegacyCatalogDelta(
      client,
      input,
      { ...plan, operations: [] },
      {
        database,
        expectedMigrations: [],
        confirmPlanHash: plan.planHash,
        now: new Date("2026-10-09T08:10:00Z"),
      },
    ),
    LegacyDeltaInputError,
  );
  assert.deepEqual(calls, []);
});

// Explicit opt-in: only a fresh synthetic database on the authorized local PostgreSQL instance.
test(
  "synthetic PostgreSQL catalog delta transactions",
  { skip: process.env.INNOCHEM_DELTA_DB_TEST !== "1" },
  async (t) => {
    if (
      process.env.PGHOST !== "/tmp/innochem-postgres" ||
      process.env.PGPORT !== "55439" ||
      process.env.PGUSER !== "wojciechplonka"
    )
      throw new Error(
        "Synthetic delta DB test requires the authorized local instance",
      );
    const config = {
      host: process.env.PGHOST,
      port: 55439,
      user: process.env.PGUSER,
    };
    const db = `innochem_test_delta_apply_${Date.now()}`;
    const admin = new Client({ ...config, database: "postgres" });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${db}`);
    await admin.end();
    const client = new Client({ ...config, database: db });
    await client.connect();
    const expectedMigrations = await Promise.all(
      requiredMigrations.map(async (name) => ({
        name,
        sql: await readFile(
          new URL(`../db/migrations/${name}`, import.meta.url),
          "utf8",
        ),
      })),
    );
    try {
      await client.query(
        "CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
      );
      for (const row of expectedMigrations) {
        await client.query(row.sql);
        await client.query(
          "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
          [row.name, createHash("sha256").update(row.sql).digest("hex")],
        );
      }
      const migrations = expectedMigrations.map((row) => ({
        name: row.name,
        checksum: createHash("sha256").update(row.sql).digest("hex"),
      }));
      await client.query(
        "INSERT INTO categories(id,legacy_id,slug,name) VALUES($1,1,'synthetic-oil','Synthetic oil')",
        [categoryId],
      );
      for (const id of [1, 2])
        await client.query(
          "INSERT INTO products(id,legacy_id,slug,name,price_cents,stock,status) VALUES($1,$2,$3,$4,1230,10,'active')",
          [
            id === 1 ? productId : "00000000-0000-4000-8000-000000000003",
            id,
            `synthetic-oil-${id}`,
            `Synthetic product ${id}`,
          ],
        );
      const dedicated: LegacyCatalogDeltaClient = {
        dedicatedConnection: true,
        query: (sql, values) => client.query(sql, values),
      };
      const runtimeBinding = { database: db, expectedMigrations: migrations };
      async function candidate(
        change: (final: ReturnType<typeof source>) => void,
      ) {
        const target = await exportLegacyDeltaTarget({
          dedicatedConnection: true,
          query: (sql) => client.query(sql),
        });
        const baseline = {
          ...structuredClone(target),
          role: "source",
        } as unknown as ReturnType<typeof source>;
        for (const entity of [
          "categories",
          "products",
          "customers",
          "addresses",
          "orders",
          "orderItems",
        ] as const)
          for (const row of baseline[entity])
            delete (row as { targetId?: string }).targetId;
        const final = structuredClone(baseline);
        change(final);
        const inputs = inputsFor(baseline, final, target, db);
        const plan = await dryRunLegacyCatalogDelta(
          dedicated,
          inputs,
          runtimeBinding,
        );
        return { inputs, plan };
      }
      await t.test(
        "read-only plan leaves versions, data, outboxes and run records unchanged",
        async () => {
          const before = (
            await client.query(
              "SELECT stock,version FROM products ORDER BY legacy_id",
            )
          ).rows;
          const { plan } = await candidate((final) => {
            final.products[0].fields.stock = 11;
          });
          assert.equal(plan.applyAllowed, true);
          assert.deepEqual(
            (
              await client.query(
                "SELECT stock,version FROM products ORDER BY legacy_id",
              )
            ).rows,
            before,
          );
          assert.equal(
            (await client.query("SELECT count(*)::int AS n FROM import_runs"))
              .rows[0].n,
            0,
          );
        },
      );
      await t.test(
        "atomically applies allowlisted fields and price history once, rejects replay",
        async () => {
          const { inputs, plan } = await candidate((final) => {
            final.products[0].fields.price.amount = 1400;
            final.products[0].fields.stock = 11;
            final.categories[0].fields.position = 2;
          });
          const result = await applyLegacyCatalogDelta(
            dedicated,
            inputs,
            plan,
            { ...runtimeBinding, confirmPlanHash: plan.planHash },
          );
          assert.equal(result.operations, 2);
          const product = (
            await client.query(
              "SELECT price_cents,stock,version FROM products WHERE legacy_id=1",
            )
          ).rows[0];
          assert.deepEqual(product, {
            price_cents: 1400,
            stock: 11,
            version: 2,
          });
          assert.equal(
            (await client.query("SELECT count(*)::int AS n FROM price_history"))
              .rows[0].n,
            1,
          );
          await assert.rejects(
            applyLegacyCatalogDelta(dedicated, inputs, plan, {
              ...runtimeBinding,
              confirmPlanHash: plan.planHash,
            }),
          );
          assert.equal(
            (await client.query("SELECT count(*)::int AS n FROM import_runs"))
              .rows[0].n,
            1,
          );
          assert.equal(
            (await client.query("SELECT count(*)::int AS n FROM mail_outbox"))
              .rows[0].n,
            0,
          );
        },
      );
      await t.test(
        "later operation failure rolls back earlier updates, versions, price history and audit",
        async () => {
          const { inputs, plan } = await candidate((final) => {
            for (const row of final.products) row.fields.price.amount += 1;
          });
          const before = (
            await client.query(
              "SELECT legacy_id,price_cents,version FROM products ORDER BY legacy_id",
            )
          ).rows;
          let updates = 0;
          const failing: LegacyCatalogDeltaClient = {
            dedicatedConnection: true,
            query: async (sql, values) => {
              if (sql.startsWith("UPDATE public.products") && ++updates === 2)
                throw new Error("Synthetic injected failure");
              return client.query(sql, values);
            },
          };
          await assert.rejects(
            applyLegacyCatalogDelta(failing, inputs, plan, {
              ...runtimeBinding,
              confirmPlanHash: plan.planHash,
            }),
          );
          assert.equal(updates, 2);
          assert.deepEqual(
            (
              await client.query(
                "SELECT legacy_id,price_cents,version FROM products ORDER BY legacy_id",
              )
            ).rows,
            before,
          );
          assert.equal(
            (await client.query("SELECT count(*)::int AS n FROM price_history"))
              .rows[0].n,
            1,
          );
          assert.equal(
            (await client.query("SELECT count(*)::int AS n FROM import_runs"))
              .rows[0].n,
            1,
          );
        },
      );
      await t.test(
        "same-value version change and stale stock both invalidate a reviewed plan",
        async () => {
          for (const mutation of ["version=version+1", "stock=stock+1"]) {
            const { inputs, plan } = await candidate((final) => {
              final.products[0].fields.weightGrams += 1;
            });
            await client.query(
              `UPDATE products SET ${mutation} WHERE legacy_id=1`,
            );
            await assert.rejects(
              applyLegacyCatalogDelta(dedicated, inputs, plan, {
                ...runtimeBinding,
                confirmPlanHash: plan.planHash,
              }),
              LegacyDeltaInputError,
            );
          }
        },
      );
      await t.test(
        "simultaneous applications commit once and preserve one journal entry",
        async () => {
          const { inputs, plan } = await candidate((final) => {
            final.products[0].fields.weightGrams += 1;
          });
          const second = new Client({ ...config, database: db });
          await second.connect();
          try {
            const outcomes = await Promise.allSettled([
              applyLegacyCatalogDelta(dedicated, inputs, plan, {
                ...runtimeBinding,
                confirmPlanHash: plan.planHash,
              }),
              applyLegacyCatalogDelta(
                {
                  dedicatedConnection: true,
                  query: (sql, values) => second.query(sql, values),
                },
                inputs,
                plan,
                { ...runtimeBinding, confirmPlanHash: plan.planHash },
              ),
            ]);
            assert.equal(
              outcomes.filter((row) => row.status === "fulfilled").length,
              1,
            );
            assert.equal(
              (
                await client.query(
                  "SELECT count(*)::int AS n FROM import_runs WHERE source_hash=$1",
                  [plan.planHash],
                )
              ).rows[0].n,
              1,
            );
          } finally {
            await second.end();
          }
        },
      );
      await t.test(
        "lock contention fails within the timeout and leaves no partial changes",
        async () => {
          const { inputs, plan } = await candidate((final) => {
            final.products[0].fields.weightGrams += 1;
          });
          const blocker = new Client({ ...config, database: db });
          await blocker.connect();
          try {
            await blocker.query("BEGIN");
            await blocker.query(
              "SELECT id FROM products WHERE legacy_id=1 FOR UPDATE",
            );
            const start = Date.now();
            await assert.rejects(
              applyLegacyCatalogDelta(dedicated, inputs, plan, {
                ...runtimeBinding,
                confirmPlanHash: plan.planHash,
              }),
            );
            assert.ok(Date.now() - start < 4000);
            assert.equal(
              (
                await client.query(
                  "SELECT count(*)::int AS n FROM import_runs WHERE source_hash=$1",
                  [plan.planHash],
                )
              ).rows[0].n,
              0,
            );
          } finally {
            await blocker.query("ROLLBACK");
            await blocker.end();
          }
        },
      );
      await t.test(
        "writer commit between advisory locks and table locks invalidates checkout or whole target",
        async () => {
          for (const scenario of ["checkout", "unrelated-target"] as const) {
            const { inputs, plan } = await candidate((final) => {
              final.products[0].fields.weightGrams += 1;
            });
            const before = (
              await client.query(
                "SELECT weight_grams,version FROM products WHERE legacy_id=1",
              )
            ).rows[0];
            const writer = new Client({ ...config, database: db });
            await writer.connect();
            let writerCommitted = false;
            const racing: LegacyCatalogDeltaClient = {
              dedicatedConnection: true,
              query: async (sql, values) => {
                if (sql.startsWith("LOCK TABLE public.categories")) {
                  await writer.query("BEGIN");
                  if (scenario === "checkout")
                    await writer.query(
                      "UPDATE settings SET value=jsonb_set(value,'{checkoutEnabled}','true'::jsonb) WHERE key='store'",
                    );
                  else
                    await writer.query(
                      "UPDATE categories SET position=position+1,version=version+1 WHERE legacy_id=1",
                    );
                  await writer.query("COMMIT");
                  writerCommitted = true;
                }
                return client.query(sql, values);
              },
            };
            try {
              await assert.rejects(
                applyLegacyCatalogDelta(racing, inputs, plan, {
                  ...runtimeBinding,
                  confirmPlanHash: plan.planHash,
                }),
                LegacyDeltaInputError,
              );
              assert.equal(writerCommitted, true);
              assert.deepEqual(
                (
                  await client.query(
                    "SELECT weight_grams,version FROM products WHERE legacy_id=1",
                  )
                ).rows[0],
                before,
              );
              assert.equal(
                (
                  await client.query(
                    "SELECT count(*)::int AS n FROM import_runs WHERE source_hash=$1",
                    [plan.planHash],
                  )
                ).rows[0].n,
                0,
              );
            } finally {
              await writer.end();
              if (scenario === "checkout")
                await client.query(
                  "UPDATE settings SET value=jsonb_set(value,'{checkoutEnabled}','false'::jsonb) WHERE key='store'",
                );
            }
          }
        },
      );
      await t.test(
        "rewrite rules, inherited children and RLS drift abort before application side effects",
        async () => {
          await client.query(
            "CREATE TABLE synthetic_delta_rule_effects(marker text)",
          );
          const variants = [
            {
              create:
                "CREATE RULE synthetic_delta_rule AS ON UPDATE TO products DO ALSO INSERT INTO synthetic_delta_rule_effects(marker) VALUES('synthetic-only')",
              restore: "DROP RULE synthetic_delta_rule ON products",
            },
            {
              create:
                "CREATE TABLE synthetic_delta_child () INHERITS (products)",
              restore: "DROP TABLE synthetic_delta_child",
            },
            {
              create: "ALTER TABLE products ENABLE ROW LEVEL SECURITY",
              restore: "ALTER TABLE products DISABLE ROW LEVEL SECURITY",
            },
          ];
          for (const variant of variants) {
            const { inputs, plan } = await candidate((final) => {
              final.products[0].fields.weightGrams += 1;
            });
            const before = (
              await client.query(
                "SELECT weight_grams,version FROM products WHERE legacy_id=1",
              )
            ).rows[0];
            await client.query(variant.create);
            try {
              await assert.rejects(
                dryRunLegacyCatalogDelta(dedicated, inputs, runtimeBinding),
                LegacyDeltaInputError,
              );
              await assert.rejects(
                applyLegacyCatalogDelta(dedicated, inputs, plan, {
                  ...runtimeBinding,
                  confirmPlanHash: plan.planHash,
                }),
                LegacyDeltaInputError,
              );
              assert.deepEqual(
                (
                  await client.query(
                    "SELECT weight_grams,version FROM products WHERE legacy_id=1",
                  )
                ).rows[0],
                before,
              );
              assert.equal(
                (
                  await client.query(
                    "SELECT count(*)::int AS n FROM synthetic_delta_rule_effects",
                  )
                ).rows[0].n,
                0,
              );
              assert.equal(
                (
                  await client.query(
                    "SELECT count(*)::int AS n FROM import_runs WHERE source_hash=$1",
                    [plan.planHash],
                  )
                ).rows[0].n,
                0,
              );
            } finally {
              await client.query(variant.restore);
            }
          }
        },
      );
      await t.test(
        "CLI writes an exclusive private dry-run plan, then explicitly applies its hash once",
        async () => {
          const { inputs } = await candidate((final) => {
            final.products[0].fields.weightGrams += 1;
          });
          const directory = await mkdtemp(
            path.join(os.tmpdir(), "innochem-delta-cli-"),
          );
          const beforeEnv = { ...process.env };
          try {
            Object.assign(process.env, {
              PGHOST: config.host,
              PGPORT: "55439",
              PGUSER: config.user,
              PGDATABASE: db,
              INNOCHEM_DELTA_EXPORT_READ_ONLY: "1",
            });
            const args: string[] = [];
            for (const key of [
              "baseline",
              "final",
              "target",
              "provenance",
            ] as const) {
              const filename = path.join(directory, `${key}.json`);
              await writeFile(filename, JSON.stringify(inputs[key]), {
                mode: 0o600,
              });
              args.push(`--${key}`, filename);
            }
            args.push("--database", db);
            const output = path.join(directory, "plan.json");
            const before = (
              await client.query(
                "SELECT stock,weight_grams,version FROM products ORDER BY legacy_id",
              )
            ).rows;
            await legacyCatalogDeltaCommand([...args, "--output", output]);
            assert.equal((await stat(output)).mode & 0o777, 0o600);
            assert.deepEqual(
              (
                await client.query(
                  "SELECT stock,weight_grams,version FROM products ORDER BY legacy_id",
                )
              ).rows,
              before,
            );
            await assert.rejects(
              legacyCatalogDeltaCommand([...args, "--output", output]),
            );
            const link = path.join(directory, "linked-input.json");
            await symlink(path.join(directory, "baseline.json"), link);
            await assert.rejects(
              legacyCatalogDeltaCommand([
                "--baseline",
                link,
                ...args.slice(2),
                "--output",
                path.join(directory, "forbidden.json"),
              ]),
            );
            await chmod(path.join(directory, "baseline.json"), 0o644);
            await assert.rejects(
              legacyCatalogDeltaCommand([
                ...args,
                "--output",
                path.join(directory, "public-input-rejected.json"),
              ]),
            );
            await chmod(path.join(directory, "baseline.json"), 0o600);
            const plan = JSON.parse(await readFile(output, "utf8"));
            Object.assign(process.env, {
              INNOCHEM_DELTA_CATALOG_APPLY: "1",
              INNOCHEM_DELTA_FREEZE_CONFIRMED: "1",
              PAYMENTS_ENABLED: "false",
              MAIL_DELIVERY_ENABLED: "false",
              STORE_WORKER_ENABLED: "false",
            });
            const applyArgs = [
              ...args,
              "--apply",
              "--plan",
              output,
              "--confirm-plan-hash",
              plan.planHash,
            ];
            const result = await legacyCatalogDeltaCommand(applyArgs);
            assert.equal("applied" in result && result.applied, true);
            await assert.rejects(legacyCatalogDeltaCommand(applyArgs));
          } finally {
            for (const key of Object.keys(process.env))
              if (!(key in beforeEnv)) delete process.env[key];
            Object.assign(process.env, beforeEnv);
            await rm(directory, { recursive: true, force: true });
          }
        },
      );
      await t.test(
        "unknown migration ledger, schema drift or open checkout aborts before writes",
        async () => {
          const { inputs, plan } = await candidate((final) => {
            final.products[0].fields.weightGrams += 1;
          });
          await assert.rejects(
            applyLegacyCatalogDelta(dedicated, inputs, plan, {
              ...runtimeBinding,
              expectedMigrations: [],
              confirmPlanHash: plan.planHash,
            }),
            LegacyDeltaInputError,
          );
          await client.query(
            "UPDATE settings SET value=jsonb_set(value,'{checkoutEnabled}','true'::jsonb) WHERE key='store'",
          );
          await assert.rejects(
            applyLegacyCatalogDelta(dedicated, inputs, plan, {
              ...runtimeBinding,
              confirmPlanHash: plan.planHash,
            }),
            LegacyDeltaInputError,
          );
          await client.query(
            "UPDATE settings SET value=jsonb_set(value,'{checkoutEnabled}','false'::jsonb) WHERE key='store'",
          );
          await client.query(
            "ALTER TABLE products ADD COLUMN synthetic_unknown text",
          );
          await assert.rejects(
            dryRunLegacyCatalogDelta(dedicated, inputs, runtimeBinding),
            LegacyDeltaInputError,
          );
          await assert.rejects(
            applyLegacyCatalogDelta(dedicated, inputs, plan, {
              ...runtimeBinding,
              confirmPlanHash: plan.planHash,
            }),
            LegacyDeltaInputError,
          );
        },
      );
      console.log(JSON.stringify({ syntheticDatabase: db, preserved: true }));
    } finally {
      await client.end();
    }
  },
);
