// Synthetic fixtures only. Never grants access to the real or imported store.
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { query, database } from "../lib/server/db";
async function main() {
  if (
    !process.env.PGDATABASE?.startsWith("innochem_test_") ||
    new URL(process.env.APP_URL!).hostname !== "127.0.0.1" ||
    process.env.MAIL_DELIVERY_ENABLED === "true"
  )
    throw new Error("Synthetic local test environment required");
  await mkdir(process.env.MEDIA_ROOT!, { recursive: true, mode: 0o700 });
  const id = randomUUID(),
    email = "acceptance-admin@example.test";
  await query(
    "INSERT INTO auth_user(id,name,email,\"emailVerified\",role) VALUES($1,'Synthetic administrator',$2,true,'admin')",
    [id, email],
  );
  await query(
    'INSERT INTO auth_account("accountId","providerId","userId",password,"updatedAt") VALUES($1::text,\'credential\',$1::uuid,$2,now())',
    [id, await hashPassword("Synthetic-only-acceptance-2026")],
  );
  await query(
    "INSERT INTO categories(name,slug) VALUES('Test oils','test-oils')",
  );
  await query(
    "INSERT INTO products(name,slug,sku,summary,description_html,price_cents,stock,status) VALUES('Synthetic oil','synthetic-oil','SYNTHETIC','Fictional acceptance fixture','<p>Synthetic test product.</p>',8000,5,'active')",
  );
  await query(
    "INSERT INTO inquiries(subject,name,email,message) VALUES('Synthetic inquiry','Synthetic buyer','acceptance-buyer@example.test','Local test only. Do not send mail.')",
  );
  console.log("Synthetic browser fixtures created. Outbound mail disabled.");
}
main().finally(() => database().end());
