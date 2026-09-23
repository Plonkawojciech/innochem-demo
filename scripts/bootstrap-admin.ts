/** Explicit operator bootstrap. Never upgrades or overwrites an existing account. */
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { transaction, database } from "../lib/server/db";
async function main() {
  if (process.env.ADMIN_IDENTITY_VERIFIED !== "true")
    throw new Error(
      "Verify the administrator's identity and set ADMIN_IDENTITY_VERIFIED=true",
    );
  const email = z.email().parse(process.env.ADMIN_EMAIL).toLowerCase();
  const name = z.string().trim().min(2).max(120).parse(process.env.ADMIN_NAME);
  const password = z
    .string()
    .min(16)
    .max(128)
    .parse(process.env.ADMIN_PASSWORD);
  const hash = await hashPassword(password),
    id = randomUUID();
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(784152610)");
    if (
      (
        await db.query("SELECT id FROM auth_user WHERE lower(email)=$1", [
          email,
        ])
      ).rowCount
    )
      throw new Error(
        "Account already exists; bootstrap will not overwrite it or grant it new privileges",
      );
    await db.query(
      "INSERT INTO auth_user(id,name,email,\"emailVerified\",role) VALUES($1,$2,$3,true,'admin')",
      [id, name, email],
    );
    await db.query(
      'INSERT INTO auth_account("accountId","providerId","userId",password,"updatedAt") VALUES($1::text,\'credential\',$1::uuid,$2,now())',
      [id, hash],
    );
    await db.query(
      "INSERT INTO audit_log(actor_id,action,entity_id,data) VALUES('operator:bootstrap','admin.created',$1,'{}')",
      [id],
    );
  });
  console.log(
    "Administrator created. No email was sent. Store and payment switches were not changed.",
  );
}
main()
  .catch(() => {
    console.error(
      "Administrator was not created. Check the explicit identity confirmation, required values and whether the account already exists.",
    );
    process.exitCode = 1;
  })
  .finally(() => database().end());
