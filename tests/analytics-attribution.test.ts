import test from "node:test";
import assert from "node:assert/strict";
import {
  safeCampaignQuery,
  safePageLocation,
  safePath,
  safeReferrer,
  stopAnalytics,
  track,
} from "../lib/analytics";

const origin = "https://store.example.test";
test("attribution: public campaign labels survive without arbitrary query or fragments", () => {
  assert.equal(
    safePageLocation(
      origin,
      "/katalog#private",
      "?q=buyer%40example.test&token=secret&gclid=person-id&utm_campaign=autumn_2026&utm_source=Google&utm_medium=organic&utm_content=header-link&utm_term=engine-oil",
    ),
    origin +
      "/katalog?utm_source=Google&utm_medium=organic&utm_campaign=autumn_2026&utm_content=header-link&utm_term=engine-oil",
  );
  assert.equal(
    safeCampaignQuery("/", "?utm_source=%67oogle&utm_medium=cpc"),
    "?utm_source=google&utm_medium=cpc",
  );
  assert.equal(
    safeCampaignQuery(
      "/",
      "?utm_source=newsletter&utm_medium=email&utm_campaign=autumn_2026",
    ),
    "?utm_source=newsletter&utm_medium=email&utm_campaign=autumn_2026",
  );
});

test("attribution: duplicate, encoded PII, tokens, controls and long labels are dropped", () => {
  const rejected = [
    "buyer@example.test",
    "buyer%40example.test",
    "buyer%2540example.test",
    "https%3A%2F%2Fexample.test",
    "source%0aemail",
    "source%00mail",
    "source%20mail",
    "%E2%80%8Bgoogle",
    "g%C3%B3ogle",
    "phone-123456789",
    "secret-session",
    "reset-token",
    "deadbeefcafebabe",
    "user-12345678-abcd-4321-abcd-123456789abc",
    "123456789",
    "x".repeat(65),
    "",
  ];
  for (const value of rejected) {
    assert.equal(
      safeCampaignQuery("/katalog", `?utm_source=${value}&utm_medium=cpc`),
      "?utm_medium=cpc",
      value,
    );
  }
  assert.equal(
    safeCampaignQuery(
      "/",
      "?utm_source=google&%75tm_source=other&utm_medium=cpc",
    ),
    "?utm_medium=cpc",
  );
  assert.equal(safeCampaignQuery("/", `?utm_source=${"x".repeat(2049)}`), "");
});

test("attribution: account, checkout, order and admin paths cannot acquire campaign parameters", () => {
  const paths = new Map([
    ["/konto", "/konto/[strona]"],
    ["/konto/nowe-haslo?token=private", "/konto/[strona]"],
    ["/%6bonto/nowe-haslo", "/konto/[strona]"],
    ["/zamowienie", "/zamowienie"],
    ["/zamowienie/private-order-id", "/zamowienie/[id]"],
    ["/%7aamowienie/private-order-id", "/zamowienie/[id]"],
    ["/admin", "/admin/[strona]"],
    ["/admin/zamowienia/private-order-id", "/admin/[strona]"],
    ["//konto/token", "/konto/[strona]"],
    ["/%256bonto/token", "/[strona]"],
    ["/buyer%40example.test", "/[strona]"],
    ["/broken%", "/[strona]"],
  ]);
  for (const [path, masked] of paths) {
    assert.equal(safePath(path), masked, path);
    assert.equal(safePath(masked), masked, `Mask is stable: ${path}`);
    assert.equal(
      safePageLocation(origin, path, "?utm_source=google&utm_medium=cpc"),
      origin + masked,
      path,
    );
  }
});

test("attribution: initial external referrer is origin-only; SPA referrers use masked paths", () => {
  assert.equal(
    safeReferrer(
      "https://search.example.test/person@example.test?token=private#reset",
      origin,
    ),
    "https://search.example.test",
  );
  assert.equal(safeReferrer(origin + "/katalog?token=private", origin), "");
  assert.equal(
    safeReferrer(
      origin + "/katalog?utm_source=google&q=private#hidden",
      origin,
      true,
    ),
    origin + "/katalog",
  );
  assert.equal(
    safeReferrer(origin + "/konto/nowe-haslo?token=private", origin, true),
    origin + "/konto/[strona]",
  );
  assert.equal(
    safeReferrer(
      origin + "/zamowienie/private-order-id?token=private",
      origin,
      true,
    ),
    origin + "/zamowienie/[id]",
  );
  assert.equal(
    safeReferrer(origin + "/zamowienie/[id]", origin, true),
    origin + "/zamowienie/[id]",
  );
  for (const referrer of [
    "https://user:private@source.example.test/path",
    "javascript:alert(1)",
    "data:text/html,private",
    "/katalog?token=private",
    "https://source.example.test/\nprivate",
    "https://source.example.test/" + "a".repeat(2049),
  ])
    assert.equal(safeReferrer(referrer, origin, true), "", referrer);
});

test("attribution: config/events sanitize URL overrides and consent still controls disposable runtime", () => {
  const oldId = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
  const saved = ["window", "document", "location"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  let scripts = 0;
  let frames = 0;
  let removed = 0;
  const bases: string[] = [];
  const tag = {
    document: {
      referrer: origin + "/konto/nowe-haslo?token=private",
      createElement: (tagName: string) => ({ tagName, href: "" }),
      head: {
        appendChild: (node: { tagName: string; href: string }) => {
          if (node.tagName === "script") scripts++;
          else if (node.tagName === "base") bases.push(node.href);
        },
      },
    },
    dataLayer: [] as IArguments[],
  };
  const iframe = {
    contentWindow: tag,
    referrerPolicy: "",
    setAttribute: () => {},
    remove: () => removed++,
  };
  const doc = {
    cookie: "",
    title: "INNOCHEM",
    referrer: "https://search.example.test/private?email=buyer%40example.test",
    createElement: () => iframe,
    body: { appendChild: () => frames++ },
  };
  const location = {
    origin,
    hostname: "store.example.test",
    pathname: "/katalog",
    search:
      "?utm_source=google&utm_medium=cpc&token=private&q=buyer%40example.test",
  };
  for (const [key, value] of [
    ["window", {}],
    ["document", doc],
    ["location", location],
  ] as const)
    Object.defineProperty(globalThis, key, { value, configurable: true });
  const commands = () => tag.dataLayer.map((entry) => Array.from(entry));
  const latestParams = () => commands().at(-1)![2] as Record<string, unknown>;
  try {
    process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID = "G-TEST123";
    assert.equal(track("page_view"), false);
    assert.equal(frames, 0);
    assert.equal(scripts, 0);
    doc.cookie = `innochem-consent=${encodeURIComponent(JSON.stringify({ v: 1, analytics: true, at: new Date().toISOString() }))}`;
    assert.equal(track("page_view"), true);
    assert.equal(scripts, 1);
    assert.equal(frames, 1);
    assert.equal(iframe.referrerPolicy, "no-referrer");
    assert.equal(tag.document.referrer, "");
    assert.equal(
      Object.getOwnPropertyDescriptor(tag.document, "referrer")?.configurable,
      false,
    );
    assert.deepEqual(bases, [origin + "/"]);
    const config = commands().find(
      (entry) => entry[0] === "config",
    )![2] as Record<string, unknown>;
    assert.equal(
      config.page_location,
      origin + "/katalog?utm_source=google&utm_medium=cpc",
    );
    assert.equal(config.page_referrer, "https://search.example.test");
    assert.equal(config.send_page_view, false);
    assert.equal(latestParams().page_referrer, "https://search.example.test");

    track("page_view", {
      page_location: "https://evil.example.test/?email=buyer@example.test",
      page_referrer: origin + "/konto/nowe-haslo?token=private",
      page_title: "Caller cannot override title",
    });
    assert.equal(latestParams().page_location, config.page_location);
    assert.equal(latestParams().page_referrer, origin + "/konto/[strona]");
    assert.equal(latestParams().page_title, "INNOCHEM");

    location.pathname = "/zamowienie/private-order-id";
    doc.title = "private-order-id";
    track("page_view", {
      page_referrer: "https://source.example.test/private?token=private",
    });
    assert.equal(latestParams().page_location, origin + "/zamowienie/[id]");
    assert.equal(latestParams().page_title, "Zamówienie — INNOCHEM");
    assert.equal(latestParams().page_referrer, "https://source.example.test");
    assert.ok(!JSON.stringify(commands()).includes("private-order-id"));
    assert.ok(!JSON.stringify(commands()).includes("token=private"));
    assert.ok(!JSON.stringify(commands()).includes("buyer"));
    location.pathname = "/%61dmin/zamowienia/private-order-id";
    const beforeAdmin = tag.dataLayer.length;
    assert.equal(track("page_view"), false);
    assert.equal(tag.dataLayer.length, beforeAdmin);
    doc.cookie = "";
    stopAnalytics();
    assert.equal(removed, 1);
    assert.equal(tag.dataLayer.length, 0);
    assert.equal(track("page_view"), false);
    assert.equal(scripts, 1);
  } finally {
    stopAnalytics();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    if (oldId === undefined) delete process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
    else process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID = oldId;
  }
});
