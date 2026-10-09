import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { checkoutTestConfiguration } from "./helpers/checkout-test-config.mjs";

const flags = {
  STOREFRONT_PREVIEW: "true",
  MAIL_DELIVERY_ENABLED: "false",
  PAYMENTS_ENABLED: "false",
  STORE_WORKER_ENABLED: "false",
  APP_URL: "http://127.0.0.1:3000",
};
const local = {
  ...flags,
  PGHOST: "/tmp/innochem-postgres",
  PGPORT: "55439",
  PGUSER: "wojciechplonka",
  PGDATABASE: "innochem_test_checkout_fixture",
};
const vm = {
  ...flags,
  INNOCHEM_TEST_PG_SOCKET: "/pg-test-socket",
  INNOCHEM_DELTA_DB_TEST: "1",
  PGHOST: "innochem-theme-gate-r20261009t230000-db",
  PGPORT: "5432",
  PGUSER: "innochem_theme_gate",
  PGDATABASE: "innochem_test_theme_r20261009t230000",
};

test("checkout tests accept the exact local synthetic database connection", () => {
  assert.deepEqual(checkoutTestConfiguration(local), {
    databaseHost: local.PGHOST,
    socketHost: "/tmp/innochem-postgres",
    port: "55439",
    database: local.PGDATABASE,
    user: "wojciechplonka",
  });
  assert.equal(
    checkoutTestConfiguration({
      ...local,
      PGUSER: undefined,
      USER: "wojciechplonka",
    }).user,
    "wojciechplonka",
  );
});

test("checkout tests accept only a fully matched VM connection and private socket", () => {
  const env = Object.freeze({ ...vm, PGPASSWORD: "synthetic-unit-sentinel" });
  const config = checkoutTestConfiguration(env);
  assert.deepEqual(config, {
    databaseHost: vm.PGHOST,
    socketHost: "/pg-test-socket",
    port: "5432",
    database: vm.PGDATABASE,
    user: "innochem_theme_gate",
  });
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.hasOwn(config, "password"), false);
  assert.equal(env.PGHOST, vm.PGHOST);
});

test("checkout tests reject remote, production and wrong local connection targets", () => {
  for (const override of [
    { PGHOST: "localhost" },
    { PGHOST: "innochem-db" },
    { PGHOST: "/var/run/postgresql" },
    { PGPORT: "5432" },
    { PGPORT: "055439" },
    { PGUSER: undefined },
    { PGUSER: undefined, USER: "foreign" },
    { PGUSER: "postgres" },
    { PGDATABASE: "innochem" },
    { PGDATABASE: "innochem_test_" },
    { PGDATABASE: "innochem_test_unsafe-name" },
    { PGDATABASE: "innochem_test_" + "a".repeat(50) },
  ])
    assert.throws(() => checkoutTestConfiguration({ ...local, ...override }));
});

test("checkout tests require explicit VM opt-in and the fixed socket mount", () => {
  for (const optIn of [undefined, "", "0", "true", "2"])
    assert.throws(() =>
      checkoutTestConfiguration({ ...vm, INNOCHEM_DELTA_DB_TEST: optIn }),
    );
  for (const socket of [
    undefined,
    "",
    "/tmp/innochem-postgres",
    "/pg-test-socket/",
    "/pg-test-socket/../postgresql",
    "pg-test-socket",
  ])
    assert.throws(() =>
      checkoutTestConfiguration({ ...vm, INNOCHEM_TEST_PG_SOCKET: socket }),
    );
});

test("checkout tests reject mismatched, malformed and foreign VM namespaces", () => {
  for (const override of [
    { PGHOST: "innochem-provider-sandbox-r20261009t230000-db" },
    { PGHOST: "innochem-theme-gate-r20261009t230000-db.example.com" },
    { PGHOST: "innochem-theme-gate-r20261009t230001-db" },
    { PGHOST: "innochem-theme-gate-r20261008t230000-db" },
    { PGHOST: "innochem-theme-gate-r20261009t240000-db" },
    { PGHOST: "innochem-theme-gate-r20261009t236000-db" },
    { PGHOST: "innochem-theme-gate-r20261009t230060-db" },
    { PGPORT: "55439" },
    { PGPORT: "05432" },
    { PGUSER: "postgres" },
    { PGUSER: "wojciechplonka" },
    { PGDATABASE: "innochem" },
    { PGDATABASE: "innochem_test_checkout_fixture" },
    { PGDATABASE: "innochem_test_theme_r20261009t230001" },
  ])
    assert.throws(() => checkoutTestConfiguration({ ...vm, ...override }));
});

test("checkout tests require preview and every real transport disabled", () => {
  for (const env of [local, vm])
    for (const key of [
      "STOREFRONT_PREVIEW",
      "MAIL_DELIVERY_ENABLED",
      "PAYMENTS_ENABLED",
      "STORE_WORKER_ENABLED",
    ])
      for (const value of [undefined, "", "1", "incorrect"])
        assert.throws(() =>
          checkoutTestConfiguration({ ...env, [key]: value }),
        );
});

test("checkout tests accept only a loopback HTTP application origin", () => {
  for (const appUrl of [
    "http://localhost:3000",
    "http://[::1]:3000",
    "http://127.0.0.1:13087",
  ])
    assert.doesNotThrow(() =>
      checkoutTestConfiguration({ ...local, APP_URL: appUrl }),
    );
  for (const appUrl of [
    undefined,
    "invalid",
    "https://127.0.0.1:3000",
    "http://127.0.0.1.example.com",
    "https://sklep-innochem.programo.pl",
    "http://user:synthetic@127.0.0.1:3000",
    "http://127.0.0.1:3000/path",
    "http://127.0.0.1:3000/?query",
    "http://127.0.0.1:3000/#fragment",
  ])
    assert.throws(() =>
      checkoutTestConfiguration({ ...local, APP_URL: appUrl }),
    );
});

test("checkout tests reject database URLs and session overrides without exposing credentials", () => {
  const sentinel = "synthetic-unit-sentinel";
  for (const env of [local, vm])
    for (const key of ["DATABASE_URL", "PGOPTIONS"])
      for (const value of ["", sentinel])
        assert.throws(
          () =>
            checkoutTestConfiguration({
              ...env,
              [key]: value,
              PGPASSWORD: sentinel,
            }),
          (error) =>
            error instanceof Error &&
            error.message ===
              "Checkout regression requires the isolated test configuration" &&
            !error.message.includes(sentinel),
        );
});

test("checkout network guard blocks TCP and fetch before any original connect call", () => {
  const isolationUrl = new URL(
    "./helpers/checkout-network-isolation.mjs",
    import.meta.url,
  ).href;
  const code = `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    let calls = 0;
    net.Socket.prototype.connect = function () { calls++; return this; };
    const { checkoutNetworkIsolation } = await import(${JSON.stringify(isolationUrl)});
    const repeated = await import(${JSON.stringify(isolationUrl + "?reload")});
    assert.strictEqual(repeated.checkoutNetworkIsolation, checkoutNetworkIsolation);
    for (const [key, value] of [['PGHOST', 'innochem-db'], ['PGDATABASE', 'innochem_test_other']]) {
      const before = process.env[key];
      process.env[key] = value;
      try { await assert.rejects(import(${JSON.stringify(isolationUrl)} + '?changed-' + key), /Checkout regression requires/); }
      finally { process.env[key] = before; }
    }
    const blockedFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('synthetic override'); };
    try { await assert.rejects(import(${JSON.stringify(isolationUrl + "?changed-fetch")}), /Checkout regression requires/); }
    finally { globalThis.fetch = blockedFetch; }
    assert.equal(process.env.PGHOST, checkoutNetworkIsolation.socketHost);
    for (const args of [
      [443, 'checkout.stripe.com'],
      [5432, '127.0.0.1'],
      [{ port: 443, host: 'www.apaczka.pl' }],
      ['/foreign/.s.PGSQL.5432'],
    ]) assert.throws(() => new net.Socket().connect(...args), /blocked/);
    await assert.rejects(fetch('https://www.apaczka.pl/'), /blocked/);
    assert.equal(calls, 0);
    const socket = checkoutNetworkIsolation.socketHost + '/.s.PGSQL.' + checkoutNetworkIsolation.port;
    new net.Socket().connect({ path: socket });
    assert.equal(calls, 1);
    console.log('ISOLATION_PASS');
  `;
  for (const env of [local, vm]) {
    const child = spawnSync(process.execPath, ["--eval", code], {
      env,
      encoding: "utf8",
      timeout: 3000,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0);
    assert.equal(child.stdout.trim(), "ISOLATION_PASS");
    assert.equal(child.stderr, "");
  }
});
