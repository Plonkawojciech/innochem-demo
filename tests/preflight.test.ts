import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { preflight, formatChecks } from "../scripts/preflight";
const valid: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  APP_URL: "https://synthetic.example.test",
  BETTER_AUTH_SECRET: "synthetic-auth-secret-0000000000000000",
  WORKER_SECRET: "synthetic-worker-secret-0000000000000000",
  PGHOST: "synthetic-db",
  PGDATABASE: "synthetic-database",
  PGUSER: "synthetic-user",
  PGPASSWORD: "synthetic-password",
  MEDIA_ROOT: process.cwd(),
  STOREFRONT_PREVIEW: "true",
  MAIL_DELIVERY_ENABLED: "false",
  PAYMENTS_ENABLED: "false",
  TRUST_PROXY: "false",
};
test("preflight accepts disabled integrations and reports only names and descriptions", async () => {
  const checks = await preflight(valid);
  assert.ok(checks.every((check) => check.status === "OK"));
  const output = formatChecks(checks);
  for (const name of [
    "APP_URL",
    "BETTER_AUTH_SECRET",
    "WORKER_SECRET",
    "PGHOST",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
    "MEDIA_ROOT",
  ])
    assert.ok(!output.includes(valid[name]!));
});
test("preflight detects missing, malformed and inconsistent configuration", async () => {
  const checks = await preflight({
    ...valid,
    APP_URL: "https://synthetic.example.test/",
    WORKER_SECRET: valid.BETTER_AUTH_SECRET,
    PGUSER: "",
    MEDIA_ROOT: "scripts/preflight.ts",
    TRUST_PROXY: "yes",
    MAIL_DELIVERY_ENABLED: "true",
    PAYMENTS_ENABLED: "true",
    NEXT_PUBLIC_GA4_MEASUREMENT_ID: "synthetic-id",
  });
  const status = Object.fromEntries(
    checks.map((check) => [check.name, check.status]),
  );
  for (const name of [
    "APP_URL",
    "BETTER_AUTH_SECRET",
    "WORKER_SECRET",
    "MEDIA_ROOT",
    "TRUST_PROXY",
  ])
    assert.equal(status[name], "BŁĄD");
  for (const name of [
    "PGUSER",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "MAIL_FROM",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_MODE",
    "GA4_API_SECRET",
  ])
    assert.equal(status[name], "BRAK");
});
test("preflight validates enabled integrations without revealing their values", async () => {
  const env = {
    ...valid,
    MAIL_DELIVERY_ENABLED: "true",
    SMTP_HOST: "synthetic-smtp",
    SMTP_PORT: "2465",
    SMTP_USER: "synthetic-smtp-user",
    SMTP_PASSWORD: "synthetic-smtp-password",
    MAIL_FROM: "Synthetic <mail@example.test>",
    PAYMENTS_ENABLED: "true",
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: "synthetic-stripe-key",
    STRIPE_WEBHOOK_SECRET: "synthetic-webhook-key",
    NEXT_PUBLIC_GA4_MEASUREMENT_ID: "synthetic-ga-id",
    GA4_API_SECRET: "synthetic-ga-secret",
  };
  assert.ok((await preflight(env)).every((check) => check.status === "OK"));
  for (const [name, value] of [
    ["APP_URL", "http://example.test"],
    ["APP_URL", "not a url"],
    ["BETTER_AUTH_SECRET", "short"],
    ["SMTP_PORT", "NaN"],
    ["SMTP_PORT", "1.5"],
    ["SMTP_PORT", "65536"],
    ["MAIL_FROM", "mail@example.test"],
    ["MAIL_FROM", "Name\r\n <mail@example.test>"],
    ["STRIPE_MODE", "other"],
    ["STOREFRONT_PREVIEW", "yes"],
    ["MEDIA_ROOT", "/nonexistent-synthetic-preflight-directory"],
  ]) {
    assert.equal(
      (await preflight({ ...env, [name]: value })).find(
        (check) => check.name === name,
      )?.status,
      "BŁĄD",
    );
  }
  const output = formatChecks(await preflight(env));
  for (const name of [
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "MAIL_FROM",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "GA4_API_SECRET",
  ])
    assert.ok(!output.includes(env[name as keyof typeof env]!));
});
test("preflight CLI exits 0 on valid configuration and 1 on errors without values", () => {
  for (const [env, expected] of [
    [valid, 0],
    [{ ...valid, PGPASSWORD: "", APP_URL: "SENSITIVE_INVALID_URL" }, 1],
  ] as const) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/preflight.ts"],
      { env: { ...env, NODE_USE_SYSTEM_CA: "0" }, encoding: "utf8" },
    );
    assert.equal(result.status, expected, result.stderr);
    assert.ok(!result.stdout.includes("SENSITIVE_INVALID_URL"));
    assert.equal(result.stderr, "");
  }
});
