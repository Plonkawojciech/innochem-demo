/**
 * Creates (or reuses) an administrator account and prints a one-time link to set the password.
 * No password is ever chosen or shown by the operator. The link expires after 7 days and is
 * consumed by the regular reset-password flow.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { transaction, database } from "../lib/server/db";
async function main() {
  if (process.env.ADMIN_IDENTITY_VERIFIED !== "true")
    throw new Error(
      "Verify the administrator's identity and set ADMIN_IDENTITY_VERIFIED=true",
    );
  const base = z.url().parse(process.env.APP_URL);
  const email = z.email().parse(process.env.ADMIN_EMAIL).toLowerCase();
  const name = z.string().trim().min(2).max(120).parse(process.env.ADMIN_NAME);
  const token = randomBytes(24).toString("base64url");
  const created = await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(784152610)");
    const existing = (
      await db.query("SELECT id,role FROM auth_user WHERE lower(email)=$1", [
        email,
      ])
    ).rows[0];
    if (existing && existing.role !== "admin")
      throw new Error(
        "An account with this email exists and is not an administrator; invitations never promote customers",
      );
    const id: string = existing?.id ?? randomUUID();
    if (!existing) {
      // Unusable random password: the account can only be opened through the invitation link.
      const hash = await hashPassword(randomBytes(48).toString("base64url"));
      await db.query(
        "INSERT INTO auth_user(id,name,email,\"emailVerified\",role) VALUES($1,$2,$3,true,'admin')",
        [id, name, email],
      );
      await db.query(
        'INSERT INTO auth_account("accountId","providerId","userId",password,"updatedAt") VALUES($1::text,\'credential\',$1::uuid,$2,now())',
        [id, hash],
      );
    }
    await db.query(
      "DELETE FROM auth_verification WHERE value=$1 AND identifier LIKE 'reset-password:%'",
      [id],
    );
    await db.query(
      "INSERT INTO auth_verification(identifier,value,\"expiresAt\") VALUES($1,$2,now()+interval '7 days')",
      [`reset-password:${token}`, id],
    );
    await db.query(
      "INSERT INTO audit_log(actor_id,action,entity_id,data) VALUES('operator:invite','admin.invited',$1,$2)",
      [id, JSON.stringify({ created: !existing })],
    );
    return !existing;
  });
  console.log(
    `${created ? "Administrator created" : "Existing administrator"}; invitation valid for 7 days:`,
  );
  console.log(new URL(`/konto/nowe-haslo?token=${token}`, base).href);
}
main()
  .catch((e) => {
    console.error(
      e instanceof Error ? e.message : "Invitation was not created.",
    );
    process.exitCode = 1;
  })
  .finally(() => database().end());
