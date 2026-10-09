const failure = () => {
  // Never include connection strings, credentials or other environment values.
  throw new Error(
    "Checkout regression requires the isolated test configuration",
  );
};

/** Pure test-only connection allowlist, shared by npm test and test:checkout. */
export function checkoutTestConfiguration(env) {
  // Match node-postgres' local USER default while still requiring the exact owner.
  const user = env.PGUSER ?? env.USER;
  if (
    env.DATABASE_URL !== undefined ||
    env.PGOPTIONS !== undefined ||
    env.STOREFRONT_PREVIEW !== "true" ||
    env.MAIL_DELIVERY_ENABLED !== "false" ||
    env.PAYMENTS_ENABLED !== "false" ||
    env.STORE_WORKER_ENABLED !== "false"
  )
    failure();

  let appUrl;
  try {
    appUrl = new URL(env.APP_URL);
  } catch {
    failure();
  }
  if (
    appUrl.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(appUrl.hostname) ||
    appUrl.username ||
    appUrl.password ||
    appUrl.pathname !== "/" ||
    appUrl.search ||
    appUrl.hash
  )
    failure();

  let socketHost;
  if (env.INNOCHEM_TEST_PG_SOCKET === undefined) {
    if (
      env.PGHOST !== "/tmp/innochem-postgres" ||
      env.PGPORT !== "55439" ||
      user !== "wojciechplonka" ||
      !/^innochem_test_[a-z0-9_]{1,49}$/.test(env.PGDATABASE ?? "")
    )
      failure();
    socketHost = "/tmp/innochem-postgres";
  } else {
    const vmHost =
      /^innochem-theme-gate-(r20261009t(?:[01][0-9]|2[0-3])[0-5][0-9][0-5][0-9])-db$/.exec(
        env.PGHOST ?? "",
      );
    if (
      env.INNOCHEM_TEST_PG_SOCKET !== "/pg-test-socket" ||
      env.INNOCHEM_DELTA_DB_TEST !== "1" ||
      !vmHost ||
      env.PGPORT !== "5432" ||
      env.PGUSER !== "innochem_theme_gate" ||
      env.PGDATABASE !== `innochem_test_theme_${vmHost[1]}`
    )
      failure();
    socketHost = "/pg-test-socket";
  }
  return Object.freeze({
    databaseHost: env.PGHOST,
    socketHost,
    port: env.PGPORT,
    database: env.PGDATABASE,
    user,
  });
}
