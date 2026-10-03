import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { database, query } from "../lib/server/db";
import { POST } from "../app/api/cart/route";
if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
  throw new Error("Dedicated test database required");
after(async () => database().end());
test("cart allows sixty requests, rejects the sixty-first and resets after expiry", async () => {
  const previous = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = "true";
  const ip = "192.0.2.61";
  const key = createHash("sha256").update(`cart:${ip}`).digest("hex");
  const request = () =>
    new Request(`${process.env.APP_URL}/api/cart`, {
      method: "POST",
      headers: {
        origin: new URL(process.env.APP_URL!).origin,
        "content-type": "application/json",
        "x-real-ip": ip,
      },
      body: JSON.stringify({ ids: [] }),
    });
  try {
    await query(
      "INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,0,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET hits=0,expires_at=excluded.expires_at",
      [key],
    );
    for (let n = 0; n < 60; n++)
      assert.equal((await POST(request())).status, 200);
    const limited = await POST(request());
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, "RATE_LIMIT");
    await query(
      "UPDATE rate_limits SET expires_at=now()-interval '1 second' WHERE key=$1",
      [key],
    );
    assert.equal((await POST(request())).status, 200);
  } finally {
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
  }
});
