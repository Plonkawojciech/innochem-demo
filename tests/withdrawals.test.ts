import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { query, database } from "../lib/server/db";
import {
  createWithdrawal,
  accessibleWithdrawal,
  updateWithdrawal,
} from "../lib/server/withdrawals";
import { POST } from "../app/api/withdrawals/route";
import { GET } from "../app/api/withdrawals/[id]/receipt/route";
import { PUT } from "../app/api/admin/withdrawals/[id]/route";
if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error("Dedicated test database required");
after(async () => database().end());
const input = () => ({
  idempotencyKey: randomUUID(),
  name: "Synthetic Buyer",
  email: "buyer@example.test",
  purchaseReference: "Synthetic order 123",
  scope: "Całe zamówienie",
  confirmed: true,
});
test("concurrent withdrawal submissions preserve one immutable declaration and one confirmation pair", async () => {
  const value = input();
  const results = await Promise.all([
    createWithdrawal(value),
    createWithdrawal(value),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(results[0].receipt, results[1].receipt);
  assert.equal(results.filter((r) => r.replayed).length, 1);
  const mail = (
    await query(
      "SELECT count(*)::int n,bool_and(preview) preview FROM mail_outbox WHERE event_key LIKE $1",
      [`withdrawal:${results[0].id}:%`],
    )
  ).rows[0];
  assert.deepEqual(mail, { n: 2, preview: true });
  await assert.rejects(
    createWithdrawal({ ...value, scope: "Zmieniona treść" }),
    (e: any) => e.code === "IDEMPOTENCY_CONFLICT",
  );
  await updateWithdrawal(
    results[0].id,
    { version: 1, status: "in_review", note: "Synthetic handling note" },
    "test-admin",
  );
  assert.equal(
    (await accessibleWithdrawal(results[0].id, null, results[0].accessToken))
      ?.receipt,
    results[0].receipt,
  );
  await assert.rejects(
    updateWithdrawal(
      results[0].id,
      { version: 1, status: "closed", note: "" },
      "test-admin",
    ),
    (e: any) => e.code === "VERSION_CONFLICT",
  );
});
test("a withdrawal receipt is available only to its guest token or authenticated owner", async () => {
  const customer = (
    await query("INSERT INTO customers(email) VALUES($1) RETURNING id", [
      `withdrawal-${randomUUID()}@example.test`,
    ])
  ).rows[0];
  const result = await createWithdrawal(input(), customer.id);
  assert.equal(await accessibleWithdrawal(result.id, null), null);
  assert.equal(await accessibleWithdrawal(result.id, randomUUID()), null);
  assert.equal(await accessibleWithdrawal(result.id, null, "wrong"), null);
  assert.equal(
    (await accessibleWithdrawal(result.id, customer.id))?.id,
    result.id,
  );
  const origin = process.env.APP_URL!,
    ctx = { params: Promise.resolve({ id: result.id }) };
  const request = (cookie?: string) =>
    new NextRequest(`${origin}/api/withdrawals/${result.id}/receipt`, {
      headers: cookie ? { cookie } : {},
    });
  assert.equal((await GET(request(), ctx)).status, 404);
  const response = await GET(
    request(`innochem_withdrawal_${result.id}=${result.accessToken}`),
    ctx,
  );
  assert.equal(await response.text(), result.receipt);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.match(response.headers.get("content-disposition")!, /attachment/);
});
test("withdrawal endpoint needs explicit confirmation, bounds input and does not expose lookup results", async () => {
  const origin = process.env.APP_URL!;
  const request = (data: unknown, source = origin) =>
    new Request(`${origin}/api/withdrawals`, {
      method: "POST",
      headers: { origin: source, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  assert.equal(
    (await POST(request(input(), "https://example.invalid"))).status,
    403,
  );
  assert.equal(
    (await POST(request({ ...input(), confirmed: false }))).status,
    400,
  );
  const r = await POST(
    request({ ...input(), purchaseReference: "An unknown purchase number" }),
  );
  assert.equal(r.status, 201);
  const payload = await r.json();
  assert.ok(payload.id);
  assert.equal(payload.accessToken, undefined);
  assert.equal(payload.access_hash, undefined);
  assert.match(r.headers.get("set-cookie")!, /HttpOnly/);
  assert.match(payload.receipt, /An unknown purchase number/);
  const ctx = { params: Promise.resolve({ id: payload.id }) };
  assert.equal(
    (
      await PUT(
        new Request(`${origin}/api/admin/withdrawals/${payload.id}`, {
          method: "PUT",
          headers: { origin, "Content-Type": "application/json" },
          body: "{}",
        }),
        ctx,
      )
    ).status,
    401,
  );
  const count = (
    await query("SELECT count(*)::int n FROM withdrawals WHERE id=$1", [
      payload.id,
    ])
  ).rows[0].n;
  assert.equal(count, 1);
});
