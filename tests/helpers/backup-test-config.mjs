/** Test-only socket override for the isolated PostgreSQL VM gate. */
export function backupTestSocketHost(env) {
  if (env.INNOCHEM_TEST_PG_SOCKET === undefined) return undefined;
  const vmHost =
    /^innochem-theme-gate-(r20261009t(?:[01][0-9]|2[0-3])[0-5][0-9][0-5][0-9])-db$/.exec(
      env.PGHOST ?? "",
    );
  if (
    env.INNOCHEM_TEST_PG_SOCKET === "/pg-test-socket" &&
    env.INNOCHEM_DELTA_DB_TEST === "1" &&
    vmHost &&
    env.PGPORT === "5432" &&
    env.PGUSER === "innochem_theme_gate" &&
    env.PGDATABASE === `innochem_test_theme_${vmHost[1]}` &&
    env.PGOPTIONS === undefined &&
    env.DATABASE_URL === undefined
  )
    return "/pg-test-socket";
  // Keep credentials and other environment values out of errors/test output.
  throw new Error("Backup test socket requires the isolated VM test instance");
}
