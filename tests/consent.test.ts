import test from "node:test";
import assert from "node:assert/strict";
import { parseConsent } from "../lib/consent";
import { safePath, item, track } from "../lib/analytics";
test("consent expires and rejects malformed, future or obsolete decisions", () => {
  for (const raw of [
    "oops",
    "null",
    JSON.stringify({ v: 1, analytics: true, at: "2020-01-01T00:00:00.000Z" }),
    JSON.stringify({ v: 1, analytics: true, at: "2999-01-01T00:00:00.000Z" }),
    JSON.stringify({ v: 2, analytics: true, at: new Date().toISOString() }),
  ])
    assert.equal(parseConsent(raw), null);
  assert.equal(
    parseConsent(
      JSON.stringify({ v: 1, analytics: false, at: new Date().toISOString() }),
    )?.analytics,
    false,
  );
});
test("private paths, queries and fragments never reach page_location", () => {
  assert.equal(
    safePath("/zamowienie/private-id?token=secret#anything"),
    "/zamowienie/[id]",
  );
  assert.equal(safePath("/konto/nowe-haslo?token=secret"), "/konto/[strona]");
  assert.equal(safePath("/katalog?q=person@example.test"), "/katalog");
  assert.equal(track("page_view"), false);
});
test("client item contract uses gross PLN and recognized series", () => {
  assert.deepEqual(
    item({ id: "id", sku: "sku", name: "HPS 5W30", priceCents: 8000 }, 2),
    {
      item_id: "sku",
      item_name: "HPS 5W30",
      item_category: "HPS – High Performance Street",
      price: 80,
      currency: "PLN",
      quantity: 2,
    },
  );
});

test("identifiers are read only with consent, including both GA session cookie formats", async () => {
  const { analyticsIdentity, readConsent } = await import("../lib/consent");
  const before = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const doc = { cookie: "" };
  Object.defineProperty(globalThis, "document", {
    value: doc,
    configurable: true,
  });
  process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID = "G-TEST123";
  const decision = (analytics: boolean) =>
    `innochem-consent=${encodeURIComponent(JSON.stringify({ v: 1, analytics, at: new Date().toISOString() }))}`;
  try {
    doc.cookie = `${decision(false)}; _ga=GA1.1.123.456; _ga_TEST123=GS1.1.12345.1.0.0.0`;
    assert.equal(analyticsIdentity(), null);
    doc.cookie = `${decision(true)}; _ga=GA1.1.123.456; _ga_TEST123=GS1.1.12345.1.0.0.0`;
    assert.equal(analyticsIdentity()?.session_id, "12345");
    assert.equal(analyticsIdentity()?.client_id, "123.456");
    doc.cookie = `${decision(true)}; _ga=GA1.1.123.456; _ga_TEST123=GS2.1.s12345$o1$g1$t456`;
    assert.equal(analyticsIdentity()?.session_id, "12345");
    doc.cookie = decision(true);
    assert.equal(analyticsIdentity()?.client_id, null);
    doc.cookie = "";
    assert.equal(readConsent(), null);
    assert.equal(analyticsIdentity(), null);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
    if (before === undefined) delete process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
    else process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID = before;
  }
});

test("tag runtime starts after consent only, denies ads, masks URLs and is disposable", async () => {
  const { stopAnalytics } = await import("../lib/analytics");
  const before = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
  const saved = ["window", "document", "location"].map(
    (k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const,
  );
  let scripts = 0,
    frames = 0,
    removed = 0;
  const tag = {
    document: {
      createElement: (tagName: string) => ({ tagName }),
      head: {
        appendChild: (node: { tagName: string }) => {
          if (node.tagName === "script") scripts++;
        },
      },
    },
    dataLayer: [] as IArguments[],
  };
  const doc = {
    cookie: "",
    title: "private order id",
    createElement: () => ({
      contentWindow: tag,
      setAttribute: () => {},
      remove: () => {
        removed++;
      },
    }),
    body: {
      appendChild: () => {
        frames++;
      },
    },
  };
  Object.defineProperty(globalThis, "window", {
    value: {},
    configurable: true,
  });
  Object.defineProperty(globalThis, "document", {
    value: doc,
    configurable: true,
  });
  Object.defineProperty(globalThis, "location", {
    value: {
      hostname: "innochem.test",
      origin: "https://innochem.test",
      pathname: "/zamowienie/private-id",
      search: "?token=secret",
    },
    configurable: true,
  });
  try {
    process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID = "";
    assert.equal(track("page_view"), false);
    process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID = "G-TEST123";
    assert.equal(track("page_view"), false);
    assert.equal(frames, 0);
    assert.equal(scripts, 0);
    doc.cookie = `innochem-consent=${encodeURIComponent(JSON.stringify({ v: 1, analytics: true, at: new Date().toISOString() }))}`;
    assert.equal(track("page_view"), true);
    assert.equal(track("view_cart", { items: [] }), true);
    assert.equal(scripts, 1);
    const commands = tag.dataLayer.map((x) => Array.from(x));
    assert.equal(commands[0][0], "consent");
    assert.equal(commands[1][1], "update");
    assert.deepEqual(commands[1][2], {
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    assert.equal(
      (commands.find((x) => x[0] === "config")![2] as Record<string, unknown>)
        .send_page_view,
      false,
    );
    assert.ok(!JSON.stringify(commands).includes("private-id"));
    assert.ok(!JSON.stringify(commands).includes("token=secret"));
    doc.cookie = "";
    stopAnalytics();
    assert.equal(removed, 1);
    assert.equal(track("page_view"), false);
    assert.equal(tag.dataLayer.length, 0);
  } finally {
    stopAnalytics();
    for (const [k, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, k, descriptor);
      else Reflect.deleteProperty(globalThis, k);
    }
    if (before === undefined) delete process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
    else process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID = before;
  }
});
