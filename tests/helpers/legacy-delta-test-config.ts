type DeltaTestEnvironment = Readonly<Record<string, string | undefined>>;

/** Test-only allowlist. The integration test creates a new database, never PGDATABASE. */
export function legacyDeltaTestDatabaseConfig(env: DeltaTestEnvironment) {
  if (env.INNOCHEM_DELTA_DB_TEST === "1") {
    // Preserve the original authorized local-instance guard exactly.
    if (
      env.PGHOST === "/tmp/innochem-postgres" &&
      env.PGPORT === "55439" &&
      env.PGUSER === "wojciechplonka"
    )
      return { host: env.PGHOST, port: 55439, user: env.PGUSER };

    const vmHost =
      /^innochem-theme-gate-(r[0-9]{8}t(?:[01][0-9]|2[0-3])[0-5][0-9][0-5][0-9])-db$/.exec(
        env.PGHOST ?? "",
      );
    if (
      vmHost &&
      env.PGPORT === "5432" &&
      env.PGUSER === "innochem_theme_gate" &&
      env.PGDATABASE === `innochem_test_theme_${vmHost[1]}` &&
      !env.PGOPTIONS
    )
      return { host: env.PGHOST!, port: 5432, user: env.PGUSER };
  }
  // Do not include environment values or passwords in errors/test output.
  throw new Error(
    "Synthetic delta DB test requires the authorized local or isolated VM instance",
  );
}
