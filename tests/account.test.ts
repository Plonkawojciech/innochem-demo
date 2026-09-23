import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { query, database } from "../lib/server/db";
import {
  saveAddress,
  archiveAddress,
  saveProfile,
  accountOverview,
} from "../lib/server/account";
import { StoreError } from "../lib/server/orders";
import { PUT } from "../app/api/account/[[...resource]]/route";
if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error("Dedicated test database required");
after(async () => database().end());
async function customer() {
  const {
    rows: [row],
  } = await query(
    "INSERT INTO customers(email,first_name,last_name) VALUES($1,'Synthetic','Customer') RETURNING id",
    [`synthetic-${randomUUID()}@example.test`],
  );
  return row.id as string;
}
const address = () => ({
  label: "Synthetic address",
  data: {
    firstName: "Synthetic",
    lastName: "Customer",
    street: "Test 1",
    street2: "",
    postalCode: "00-001",
    city: "Warszawa",
    country: "PL",
    company: "",
    nip: "",
    phone: "",
  },
});
const isError = (code: string) => (e: unknown) =>
  e instanceof StoreError && e.code === code;
test("address updates and archival enforce customer ownership", async () => {
  const owner = await customer(),
    stranger = await customer(),
    a = await saveAddress(owner, address());
  await assert.rejects(
    saveAddress(stranger, { ...address(), version: 1, label: "Stolen" }, a.id),
    isError("NOT_FOUND"),
  );
  await assert.rejects(
    archiveAddress(stranger, a.id, { version: 1, archived: true }),
    isError("NOT_FOUND"),
  );
  assert.equal((await accountOverview(stranger)).addresses.length, 0);
  const own = await accountOverview(owner);
  assert.equal(own.addresses[0].label, "Synthetic address");
  assert.equal(own.addresses[0].archived, false);
});
test("address archival is reversible and preserves the original record", async () => {
  const id = await customer(),
    a = await saveAddress(id, address());
  await archiveAddress(id, a.id, { version: 1, archived: true });
  await assert.rejects(
    saveAddress(id, { ...address(), version: 2 }, a.id),
    isError("ADDRESS_ARCHIVED"),
  );
  await archiveAddress(id, a.id, { version: 2, archived: false });
  const overview = await accountOverview(id);
  assert.equal(overview.addresses.length, 1);
  assert.equal(overview.addresses[0].id, a.id);
  assert.equal(overview.addresses[0].version, 3);
});
test("concurrent address edits cannot silently overwrite each other", async () => {
  const id = await customer(),
    a = await saveAddress(id, address());
  const result = await Promise.allSettled([
    saveAddress(id, { ...address(), label: "One", version: 1 }, a.id),
    saveAddress(id, { ...address(), label: "Two", version: 1 }, a.id),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (result.find((r) => r.status === "rejected") as PromiseRejectedResult)
      .reason.code,
    "VERSION_CONFLICT",
  );
});
test("profile editing cannot change ownership, email, roles or historical orders", async () => {
  const id = await customer();
  await assert.rejects(
    saveProfile(id, {
      version: 1,
      firstName: "New",
      lastName: "Name",
      email: "takeover@example.test",
    }),
  );
  await assert.rejects(
    saveAddress(id, { ...address(), customerId: randomUUID() }),
  );
  const {
    rows: [o],
  } = await query(
    "INSERT INTO orders(customer_id,email,buyer,shipping_address,status,payment_method,subtotal_cents,shipping_cents,total_cents,shipping_method,shipping_label,terms_version) VALUES($1,'original@example.test','{\"firstName\":\"Original\"}','{\"street\":\"Original 1\"}','legacy','legacy',100,0,100,'legacy','Legacy','legacy') RETURNING id",
    [id],
  );
  await saveProfile(id, { version: 1, firstName: "New", lastName: "Name" });
  const a = await saveAddress(id, address());
  await saveAddress(id, { ...address(), version: 1, label: "Updated" }, a.id);
  const {
    rows: [old],
  } = await query(
    "SELECT email,buyer,shipping_address FROM orders WHERE id=$1",
    [o.id],
  );
  assert.equal(old.email, "original@example.test");
  assert.deepEqual(old.buyer, { firstName: "Original" });
  assert.deepEqual(old.shipping_address, { street: "Original 1" });
});
test("the entire order history remains reachable beyond the first 100 orders", async () => {
  const owner = await customer(),
    stranger = await customer();
  await query(
    "INSERT INTO orders(customer_id,email,buyer,shipping_address,status,payment_method,subtotal_cents,shipping_cents,total_cents,shipping_method,shipping_label,terms_version) SELECT $1,'synthetic@example.test','{}','{}','legacy','legacy',100,0,100,'legacy','Legacy','legacy' FROM generate_series(1,126)",
    [owner],
  );
  const first = await accountOverview(owner, 1),
    last = await accountOverview(owner, 6);
  assert.equal(first.total, 126);
  assert.equal(first.orders.length, 25);
  assert.equal(last.orders.length, 1);
  assert.notEqual(first.orders[0].id, last.orders[0].id);
  assert.equal((await accountOverview(stranger)).total, 0);
});
test("account writes reject unauthenticated and cross-origin requests", async () => {
  const base = process.env.APP_URL!,
    context = { params: Promise.resolve({ resource: ["profile"] }) };
  const request = (origin: string) =>
    new Request(`${base}/api/account/profile`, {
      method: "PUT",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 1,
        firstName: "Test",
        lastName: "Customer",
      }),
    });
  assert.equal((await PUT(request(base), context)).status, 401);
  assert.equal(
    (await PUT(request("https://example.invalid"), context)).status,
    403,
  );
});
