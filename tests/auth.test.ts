import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { auth, requireAdmin, customerForSession } from "../lib/server/auth";
import { database, query } from "../lib/server/db";
import { POST as adminPost } from "../app/api/admin/[resource]/[[...id]]/route";
import { POST as uploadPost } from "../app/api/admin/upload/route";
import { GET as exportGet } from "../app/api/admin/export/route";
if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error("Dedicated test database required");
after(async () => database().end());
const origin = process.env.APP_URL!;
const password = "Synthetic-only-acceptance-2026";
function request(
  endpoint: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}/api/auth/${endpoint}`, {
    method: "POST",
    headers: { origin, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
async function user(role = "customer", verified = true) {
  const id = randomUUID(),
    email = `synthetic-${id}@example.test`;
  await query(
    "INSERT INTO auth_user(id,name,email,\"emailVerified\",role) VALUES($1,'Synthetic tester',$2,$3,$4)",
    [id, email, verified, role],
  );
  await query(
    'INSERT INTO auth_account("accountId","providerId","userId",password,"updatedAt") VALUES($1::text,\'credential\',$1::uuid,$2,now())',
    [id, await hashPassword(password)],
  );
  return { id, email };
}
async function login(email: string) {
  const r = await auth().handler(request("sign-in/email", { email, password }));
  assert.equal(r.status, 200);
  return new Headers({
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
    origin,
    "Content-Type": "application/json",
  });
}
test("admin endpoints reject anonymous requests and cross-origin writes before mutation", async () => {
  const context = { params: Promise.resolve({ resource: "products" }) };
  const unauthorized = await adminPost(
    new Request(`${origin}/api/admin/products`, {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: "{}",
    }),
    context,
  );
  assert.equal(unauthorized.status, 401);
  const crossOrigin = await adminPost(
    new Request(`${origin}/api/admin/products`, {
      method: "POST",
      headers: {
        origin: "https://example.invalid",
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
    context,
  );
  assert.equal(crossOrigin.status, 403);
  assert.equal(
    (
      await uploadPost(
        new Request(`${origin}/api/admin/upload`, {
          method: "POST",
          headers: { origin },
          body: "x",
        }),
      )
    ).status,
    401,
  );
  assert.equal(
    (await exportGet(new Request(`${origin}/api/admin/export`))).status,
    401,
  );
});
test("ordinary accounts cannot administer the shop or export customer data", async () => {
  const u = await user(),
    headers = await login(u.email);
  await assert.rejects(requireAdmin(headers), /FORBIDDEN/);
  assert.equal(
    (
      await adminPost(
        new Request(`${origin}/api/admin/products`, {
          method: "POST",
          headers,
          body: "{}",
        }),
        { params: Promise.resolve({ resource: "products" }) },
      )
    ).status,
    403,
  );
  assert.equal(
    (await exportGet(new Request(`${origin}/api/admin/export`, { headers })))
      .status,
    403,
  );
});
test("admin rights are checked against the database on every request", async () => {
  const u = await user("admin"),
    headers = await login(u.email);
  assert.equal((await requireAdmin(headers)).id, u.id);
  await query("UPDATE auth_user SET role='customer' WHERE id=$1", [u.id]);
  await assert.rejects(requireAdmin(headers), /FORBIDDEN/);
});
test("registration cannot self-assign the admin role", async () => {
  const email = `registration-${randomUUID()}@example.test`;
  const r = await auth().handler(
    request("sign-up/email", {
      name: "Synthetic registrant",
      email,
      password,
      role: "admin",
    }),
  );
  assert([200, 400].includes(r.status));
  const { rows } = await query("SELECT role FROM auth_user WHERE email=$1", [
    email,
  ]);
  assert(!rows.length || rows[0].role === "customer");
});
test("imported passwordless accounts require a single-use email reset to access their history", async () => {
  const id = randomUUID(),
    email = `legacy-${id}@example.test`;
  await query(
    "INSERT INTO auth_user(id,name,email,\"emailVerified\",role) VALUES($1,'Legacy tester',$2,false,'customer')",
    [id, email],
  );
  const {
    rows: [customer],
  } = await query(
    "INSERT INTO customers(auth_user_id,email) VALUES($1,$2) RETURNING id",
    [id, email],
  );
  const response = await auth().handler(
    request("request-password-reset", {
      email,
      redirectTo: "/konto/nowe-haslo",
    }),
  );
  assert.equal(response.status, 200);
  const {
    rows: [mail],
  } = await query(
    "SELECT body_text,sent_at FROM mail_outbox WHERE recipient=$1 ORDER BY created_at DESC LIMIT 1",
    [email],
  );
  assert.equal(mail.sent_at, null);
  const url = mail.body_text.match(/https?:\/\/[^\s]+/)[0];
  const callback = await auth().handler(new Request(url));
  assert.equal(callback.status, 302);
  const token = new URL(
    callback.headers.get("location")!,
    origin,
  ).searchParams.get("token");
  assert(token);
  const reset = await auth().handler(
    request("reset-password", { token, newPassword: password }),
  );
  assert.equal(reset.status, 200);
  assert.equal(
    (
      await auth().handler(
        request("reset-password", { token, newPassword: password + "x" }),
      )
    ).status,
    400,
  );
  const headers = await login(email);
  assert.equal(await customerForSession(headers), customer.id);
  assert.equal(
    (await query('SELECT "emailVerified" FROM auth_user WHERE id=$1', [id]))
      .rows[0].emailVerified,
    true,
  );
});
