import test from "node:test";
import assert from "node:assert/strict";
import { legacyDeltaTestDatabaseConfig } from "./helpers/legacy-delta-test-config";

const local = {
  INNOCHEM_DELTA_DB_TEST: "1",
  PGHOST: "/tmp/innochem-postgres",
  PGPORT: "55439",
  PGUSER: "wojciechplonka",
};
const vm = {
  INNOCHEM_DELTA_DB_TEST: "1",
  PGHOST: "innochem-theme-gate-r20261009t230000-db",
  PGPORT: "5432",
  PGUSER: "innochem_theme_gate",
  PGDATABASE: "innochem_test_theme_r20261009t230000",
};

test("delta DB tests preserve the exact authorized local connection guard", () => {
  assert.deepEqual(legacyDeltaTestDatabaseConfig(local), {
    host: "/tmp/innochem-postgres",
    port: 55439,
    user: "wojciechplonka",
  });
  for (const [key, value] of [
    ["PGHOST", "localhost"],
    ["PGPORT", "5432"],
    ["PGUSER", "postgres"],
  ])
    assert.throws(() =>
      legacyDeltaTestDatabaseConfig({ ...local, [key]: value }),
    );
});

test("delta DB tests accept only a fully matched isolated VM namespace", () => {
  const env = Object.freeze({ ...vm, PGPASSWORD: "synthetic-unit-sentinel" });
  assert.deepEqual(legacyDeltaTestDatabaseConfig(env), {
    host: vm.PGHOST,
    port: 5432,
    user: vm.PGUSER,
  });
  assert.equal(
    Object.hasOwn(legacyDeltaTestDatabaseConfig(env), "password"),
    false,
  );
});

test("delta DB tests require explicit opt-in for local and VM instances", () => {
  for (const env of [local, vm])
    for (const value of [undefined, "", "0", "true", "2"])
      assert.throws(() =>
        legacyDeltaTestDatabaseConfig({
          ...env,
          INNOCHEM_DELTA_DB_TEST: value,
        }),
      );
});

test("delta DB tests reject production and foreign hosts before a connection", () => {
  for (const host of [
    "innochem-db",
    "159.195.206.7",
    "localhost",
    "/tmp/innochem-postgres",
    "innochem-provider-sandbox-r20261009t230000-db",
    "innochem-theme-gate-r20261009t230000-db.example.com",
    "innochem-theme-gate-r20261009t230000-db,innochem-db",
  ])
    assert.throws(() => legacyDeltaTestDatabaseConfig({ ...vm, PGHOST: host }));
});

test("delta DB tests reject malformed or out-of-scope VM stamps", () => {
  for (const stamp of [
    "r20261008t230000",
    "r20261009t240000",
    "r20261009t236000",
    "r20261009t230060",
    "r20261009t23000",
    "r20261009t230000-extra",
    "R20261009t230000",
  ])
    assert.throws(() =>
      legacyDeltaTestDatabaseConfig({
        ...vm,
        PGHOST: `innochem-theme-gate-${stamp}-db`,
        PGDATABASE: `innochem_test_theme_${stamp}`,
      }),
    );
});

test("delta DB tests reject VM users and ports outside the exact allowlist", () => {
  for (const user of [undefined, "", "postgres", "wojciechplonka", "innochem"])
    assert.throws(() => legacyDeltaTestDatabaseConfig({ ...vm, PGUSER: user }));
  for (const port of [undefined, "", "55439", "05432", "5432 ", "65536"])
    assert.throws(() => legacyDeltaTestDatabaseConfig({ ...vm, PGPORT: port }));
});

test("delta DB tests reject real, missing or differently stamped VM databases", () => {
  for (const database of [
    undefined,
    "",
    "postgres",
    "innochem",
    "innochem_production",
    "innochem_test_delta_apply_fixture",
    "innochem_test_theme_r20261009t230001",
    "innochem_test_theme_r20261009t230000_extra",
  ])
    assert.throws(() =>
      legacyDeltaTestDatabaseConfig({ ...vm, PGDATABASE: database }),
    );
});

test("delta DB tests reject VM session overrides without leaking environment values", () => {
  const sentinel = "synthetic-unit-sentinel";
  assert.throws(
    () =>
      legacyDeltaTestDatabaseConfig({
        ...vm,
        PGOPTIONS: "-c search_path=other",
        PGPASSWORD: sentinel,
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message ===
        "Synthetic delta DB test requires the authorized local or isolated VM instance" &&
      !error.message.includes(sentinel),
  );
});
