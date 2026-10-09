import "../tests/helpers/checkout-network-isolation.mjs";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";

if (
  process.env.STOREFRONT_PREVIEW !== "true" ||
  process.env.MAIL_DELIVERY_ENABLED !== "false" ||
  process.env.PAYMENTS_ENABLED !== "false" ||
  process.env.STORE_WORKER_ENABLED !== "false"
)
  throw new Error(
    "Checkout regression requires preview with transports disabled",
  );

// Verify the server's database identity before any fixture can write.
const db = new Pool({
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
});
try {
  const result = await db.query("SELECT current_database() AS name");
  if (result.rows[0].name !== process.env.PGDATABASE)
    throw new Error("Checkout regression database identity does not match");
} finally {
  await db.end();
}

const files = [
  "account",
  "auth",
  "cart-confirmation",
  "cart-rate-limit",
  "cart-state",
  "checkout-http",
  "checkout-key",
  "cod-settings",
  "legal",
  "orders",
  "shipping",
  "stripe",
  "apaczka",
  "shipments",
  "withdrawals",
  "worker",
  "worker-isolation",
];
const result = spawnSync(
  process.execPath,
  [
    "--import",
    "./tests/helpers/checkout-network-isolation.mjs",
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=1",
    ...files.map((file) => `tests/${file}.test.ts`),
  ],
  { stdio: "inherit", env: process.env },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
