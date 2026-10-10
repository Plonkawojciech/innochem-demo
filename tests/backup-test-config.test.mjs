import test from "node:test";
import assert from "node:assert/strict";
import { backupTestSocketHost } from "./helpers/backup-test-config.mjs";

const vm = {
  INNOCHEM_TEST_PG_SOCKET: "/pg-test-socket",
  INNOCHEM_DELTA_DB_TEST: "1",
  PGHOST: "innochem-theme-gate-r20261009t230000-db",
  PGPORT: "5432",
  PGUSER: "innochem_theme_gate",
  PGDATABASE: "innochem_test_theme_r20261009t230000",
};

test("backup test leaves existing local configuration unchanged without the socket knob", () => {
  const local = Object.freeze({
    PGHOST: "/tmp/innochem-postgres",
    PGPORT: "55439",
    PGUSER: "wojciechplonka",
    PGDATABASE: "innochem_test_local",
  });
  assert.equal(backupTestSocketHost(local), undefined);
  assert.equal(local.PGHOST, "/tmp/innochem-postgres");
  assert.equal(backupTestSocketHost({}), undefined);
  assert.equal(
    backupTestSocketHost({ ...vm, INNOCHEM_TEST_PG_SOCKET: undefined }),
    undefined,
  );
});

test("backup test socket override accepts only a fully matched isolated VM", () => {
  const env = Object.freeze({ ...vm, PGPASSWORD: "synthetic-unit-sentinel" });
  assert.equal(backupTestSocketHost(env), "/pg-test-socket");
  assert.equal(env.PGHOST, vm.PGHOST);
});

test("backup VM stamps cross midnight without relaxing socket or database isolation", () => {
  for (const stamp of [
    "r20261009t235959",
    "r20261010t000000",
    "r20261010t005328",
  ]) {
    const env = {
      ...vm,
      PGHOST: `innochem-theme-gate-${stamp}-db`,
      PGDATABASE: `innochem_test_theme_${stamp}`,
    };
    assert.equal(backupTestSocketHost(env), "/pg-test-socket");
    for (const override of [
      { PGHOST: `innochem-provider-sandbox-${stamp}-db` },
      { PGHOST: `https://innochem-theme-gate-${stamp}-db` },
      { PGHOST: `innochem-theme-gate-${stamp}-db.example.test` },
      { PGDATABASE: "innochem_test_theme_r20261009t230000" },
      { PGDATABASE: `innochem_test_provider_${stamp}` },
      { PGDATABASE: "innochem" },
      { INNOCHEM_TEST_PG_SOCKET: "/var/run/postgresql" },
      { PGUSER: "postgres" },
      { PGPORT: "55439" },
      { INNOCHEM_DELTA_DB_TEST: "0" },
    ])
      assert.throws(() => backupTestSocketHost({ ...env, ...override }));
  }
});

test("backup test rejects every socket path outside its fixed private mount", () => {
  for (const socket of [
    "",
    "/tmp/innochem-postgres",
    "/var/run/postgresql",
    "/pg-test-socket/",
    "/pg-test-socket/../postgresql",
    "pg-test-socket",
    "localhost",
  ])
    assert.throws(() =>
      backupTestSocketHost({ ...vm, INNOCHEM_TEST_PG_SOCKET: socket }),
    );
});

test("backup test socket requires explicit test opt-in", () => {
  for (const optIn of [undefined, "", "0", "true", "2"])
    assert.throws(() =>
      backupTestSocketHost({ ...vm, INNOCHEM_DELTA_DB_TEST: optIn }),
    );
});

test("backup test rejects production, foreign and malformed VM hosts", () => {
  for (const host of [
    undefined,
    "innochem-db",
    "159.195.206.7",
    "localhost",
    "/tmp/innochem-postgres",
    "innochem-provider-sandbox-r20261009t230000-db",
    "innochem-theme-gate-r2026109t230000-db",
    "innochem-theme-gate-r20261009t240000-db",
    "innochem-theme-gate-r20261009t236000-db",
    "innochem-theme-gate-r20261009t230060-db",
    "innochem-theme-gate-r20261009t230000-db.example.com",
  ])
    assert.throws(() => backupTestSocketHost({ ...vm, PGHOST: host }));
});

test("backup test rejects real and differently stamped VM databases", () => {
  for (const database of [
    undefined,
    "",
    "postgres",
    "innochem",
    "innochem_production",
    "innochem_test_local",
    "innochem_test_theme_r20261009t230001",
    "innochem_test_theme_r20261009t230000_extra",
  ])
    assert.throws(() => backupTestSocketHost({ ...vm, PGDATABASE: database }));
});

test("backup test rejects VM users and ports outside its exact allowlist", () => {
  for (const user of [undefined, "", "postgres", "wojciechplonka", "innochem"])
    assert.throws(() => backupTestSocketHost({ ...vm, PGUSER: user }));
  for (const port of [undefined, "", "55439", "05432", "5432 ", "65536"])
    assert.throws(() => backupTestSocketHost({ ...vm, PGPORT: port }));
});

test("backup test rejects database URLs and session overrides without exposing their values", () => {
  const sentinel = "synthetic-unit-sentinel";
  for (const key of ["DATABASE_URL", "PGOPTIONS"])
    for (const value of ["", sentinel])
      assert.throws(
        () =>
          backupTestSocketHost({
            ...vm,
            [key]: value,
            PGPASSWORD: sentinel,
          }),
        (error) =>
          error instanceof Error &&
          error.message ===
            "Backup test socket requires the isolated VM test instance" &&
          !error.message.includes(sentinel),
      );
});
