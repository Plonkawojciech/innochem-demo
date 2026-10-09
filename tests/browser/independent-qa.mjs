import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const args = process.argv.slice(2);
if (!args[0] || !args[1])
  throw new Error(
    "Usage: node tests/browser/independent-qa.mjs <preview-or-local-base> <new-evidence-directory>",
  );
const base = new URL(args[0]);
if (
  !["127.0.0.1", "localhost", "sklep-innochem.programo.pl"].includes(
    base.hostname,
  ) ||
  base.username ||
  base.password
)
  throw new Error(
    "Only the isolated local store or authorized preview is allowed",
  );
const out = path.resolve(args[1]);
const expectation = process.env.EXPECT_BEFORE === "1" ? "before" : "after";
if (!["http:", "https:"].includes(base.protocol))
  throw new Error("HTTP base required");
fs.mkdirSync(out, { recursive: false });
const report = {
  startedAt: new Date().toISOString(),
  base: base.origin,
  expectation,
  sourceSha: null,
  sourceShaReason:
    "No private runtime proof in this browser-only test; public chunks and health are recorded.",
  profile: {
    headless: true,
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    defaultPlaywrightFlags: true,
    extraFlags: [],
    reducedMotion: "no-preference",
    network: "unthrottled",
    cpu: "unthrottled",
    DPR: 1,
    isMobile: false,
    hasTouch: false,
  },
  pid: process.pid,
  issues: [],
  guards: [],
  errors: [],
  responses: [],
  forbiddenRequests: [],
  browserClosed: false,
  contextsClosed: 0,
};
const checks = [];
let browser;
let watchdog;
const save = () =>
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify({ ...report, checks }, null, 2),
  );
function check(id, condition, data, issue = null) {
  const row = { id, pass: Boolean(condition), issue, data };
  checks.push(row);
  return row;
}
function processes() {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,comm="], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((s) => s.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }));
  const own = new Set([process.pid]);
  for (let i = 0; i < 5; i++)
    for (const r of rows) if (own.has(r.ppid)) own.add(r.pid);
  return rows.filter((r) => own.has(r.pid));
}
async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
async function context(width, height = 900, theme = "light") {
  const c = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
  });
  await c.addInitScript((theme) => {
    localStorage.setItem("innochem-theme", theme);
  }, theme);
  await c.route("**/*", async (route) => {
    const req = route.request();
    if (["GET", "HEAD", "OPTIONS"].includes(req.method()))
      return route.continue();
    report.forbiddenRequests.push({
      method: req.method(),
      url: new URL(req.url()).pathname,
    });
    await route.abort("blockedbyclient");
  });
  const p = await c.newPage();
  p.on("pageerror", (error) =>
    report.errors.push({ page: p.url(), message: error.message }),
  );
  return {
    c,
    p,
    close: async () => {
      await c.close();
      report.contextsClosed++;
    },
  };
}
async function goto(p, route) {
  const response = await p.goto(new URL(route, base).href, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  await p.locator("header.site").waitFor();
  await p.waitForTimeout(700);
  const evidence = await p.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    scriptSources: [...document.scripts].map((x) => x.src).filter(Boolean),
    css: [...document.querySelectorAll("link[rel=stylesheet]")].map(
      (x) => x.href,
    ),
    text: document.querySelector(".demo-bar")?.textContent?.trim(),
    buildIdentifier:
      document.querySelector("script#__NEXT_DATA__")?.textContent || null,
  }));
  report.responses.push({
    route,
    status: response.status(),
    headers: Object.fromEntries(
      Object.entries(response.headers()).filter(([key]) =>
        [
          "cache-control",
          "content-encoding",
          "content-type",
          "date",
          "link",
          "permissions-policy",
          "referrer-policy",
          "strict-transport-security",
          "vary",
          "x-content-type-options",
          "x-frame-options",
          "x-powered-by",
          "x-robots-tag",
        ].includes(key),
      ),
    ),
    ...evidence,
  });
  return response;
}
async function active(p) {
  return p.evaluate(() => {
    const e = document.activeElement,
      r = e.getBoundingClientRect(),
      s = getComputedStyle(e);
    const samples = [
      [0.5, 0.5],
      [0.1, 0.1],
      [0.9, 0.1],
      [0.1, 0.9],
      [0.9, 0.9],
    ].map(([a, b]) => {
      const x = r.x + r.width * a,
        y = r.y + r.height * b,
        hit = document.elementFromPoint(x, y);
      return {
        x,
        y,
        onElement: Boolean(hit && (hit === e || e.contains(hit))),
        hitTag: hit?.tagName,
        hitClass: typeof hit?.className === "string" ? hit.className : "",
        hitText: (hit?.textContent || "").trim().slice(0, 100),
      };
    });
    return {
      tag: e.tagName,
      text: (e.innerText || "").trim().slice(0, 120),
      name: e.getAttribute("name"),
      href: e.getAttribute("href"),
      ariaLabel: e.getAttribute("aria-label"),
      footer: Boolean(e.closest("footer.site")),
      menu: Boolean(e.closest("#mobile-menu")),
      burger: e.matches("button.burger"),
      dialog: Boolean(e.closest("dialog[open]")),
      hasFocus: document.hasFocus(),
      rect: r.toJSON(),
      viewport: { width: innerWidth, height: innerHeight },
      scrollY,
      samples,
      style: { opacity: s.opacity, visibility: s.visibility },
      menuExpanded: document
        .querySelector("button.burger")
        ?.getAttribute("aria-expanded"),
      sticky: (() => {
        const x = document.querySelector(".sticky-buy");
        if (!x) return null;
        const s = getComputedStyle(x);
        return {
          rect: x.getBoundingClientRect().toJSON(),
          display: s.display,
          visibility: s.visibility,
          hidden: x.hasAttribute("data-hidden"),
          safeAreaPadding: s.paddingBottom,
        };
      })(),
    };
  });
}
function visible(row) {
  return (
    row.hasFocus &&
    row.rect.width > 0 &&
    row.rect.height > 0 &&
    row.rect.top >= -1 &&
    row.rect.bottom <= row.viewport.height + 1 &&
    row.samples.every((x) => x.onElement) &&
    Number(row.style.opacity) > 0 &&
    row.style.visibility === "visible"
  );
}
async function tabsUntil(p, predicate, key = "Tab", bound = 200) {
  const sequence = [];
  for (let i = 0; i < bound; i++) {
    await p.keyboard.press(key);
    await p.waitForTimeout(40);
    const x = await active(p);
    sequence.push(x);
    if (predicate(x))
      return { found: true, presses: i + 1, sequence, focus: x };
  }
  return { found: false, presses: bound, sequence, focus: sequence.at(-1) };
}
async function shot(p, filename) {
  await p.screenshot({ path: path.join(out, filename), timeout: 20000 });
  return filename;
}
async function menu(width) {
  const cx = await context(width),
    { p } = cx;
  try {
    await goto(p, "/katalog");
    const start = await tabsUntil(p, (x) => x.burger);
    check(`menu-${width}-burger-native-tab`, start.found, {
      presses: start.presses,
    });
    await p.keyboard.press("Enter");
    await p.waitForTimeout(150);
    check(
      `menu-${width}-opened`,
      (await p.locator("button.burger").getAttribute("aria-expanded")) ===
        "true",
      {},
    );
    const search = await tabsUntil(p, (x) => x.name === "q");
    await p.waitForTimeout(1750);
    const focus = await active(p);
    const image = await shot(p, `menu-search-${width}.png`);
    check(
      `INNO-02-menu-search-${width}`,
      search.found && visible(focus),
      {
        tabPresses: search.presses,
        sequence: search.sequence,
        settleMs: 1750,
        focus,
        image,
      },
      "INNO-02",
    );
    await p.keyboard.press("Escape");
    await p.waitForTimeout(250);
    check(
      `menu-${width}-escape-outside-preserves-search`,
      (await active(p)).name === "q" &&
        (await p.locator("button.burger").getAttribute("aria-expanded")) ===
          "false",
      { focus: await active(p) },
    );
    const backward = await tabsUntil(p, (x) => x.burger, "Shift+Tab");
    check(`menu-${width}-burger-shift-tab`, backward.found, {
      presses: backward.presses,
    });
    await p.keyboard.press("Enter");
    await p.waitForTimeout(150);
    const inside = await tabsUntil(p, (x) => x.menu);
    check(`menu-${width}-first-menu-link`, inside.found, {});
    await p.keyboard.press("Escape");
    await p.waitForTimeout(250);
    check(
      `menu-${width}-escape-inside-restores-burger`,
      (await active(p)).burger &&
        (await p.locator("button.burger").getAttribute("aria-expanded")) ===
          "false",
      { focus: await active(p) },
    );
    await p.keyboard.press("Enter");
    await p.waitForTimeout(150);
    const previous = await tabsUntil(
      p,
      (x) => !x.burger && !x.menu,
      "Shift+Tab",
      50,
    );
    await p.waitForTimeout(1750);
    const backwardFocus = await active(p);
    check(
      `menu-${width}-backward-exit-visible`,
      previous.found && visible(backwardFocus),
      { presses: previous.presses, focus: backwardFocus },
    );
    await p.keyboard.press("Escape");
    await p.goto(new URL("/katalog", base).href, {
      waitUntil: "domcontentloaded",
    });
    await p.waitForTimeout(700);
    await tabsUntil(p, (x) => x.burger);
    await p.keyboard.press("Enter");
    await p.waitForTimeout(150);
    const safePoint = await p.evaluate(() => {
      const r = document.querySelector("#mobile-menu").getBoundingClientRect();
      return {
        x: innerWidth - 3,
        y: Math.min(innerHeight - 10, r.bottom + 25),
        menuBottom: r.bottom,
        height: innerHeight,
      };
    });
    if (safePoint.y > safePoint.menuBottom + 5) {
      await p.mouse.click(safePoint.x, safePoint.y);
      await p.waitForTimeout(250);
      check(
        `menu-${width}-outside-pointer-closes`,
        (await p.locator("button.burger").getAttribute("aria-expanded")) ===
          "false",
        safePoint,
      );
    } else check(`menu-${width}-outside-pointer-test-space`, false, safePoint);
  } finally {
    await cx.close();
    save();
  }
}
async function contrast(p, selector) {
  return p
    .locator(selector)
    .first()
    .evaluate((e) => {
      const parse = (s) => {
        if (!/^rgba?\(/.test(s))
          throw new Error("Unsupported serialized color " + s);
        const n = s.match(/[\d.]+/g).map(Number);
        return [n[0], n[1], n[2], n[3] ?? 1];
      };
      const over = (top, bottom) =>
        top.slice(0, 3).map((c, i) => c * top[3] + bottom[i] * (1 - top[3]));
      const layers = [];
      let x = e;
      while (x) {
        const s = getComputedStyle(x);
        layers.push({
          tag: x.tagName,
          class: x.className,
          color: s.backgroundColor,
          image: s.backgroundImage,
          opacity: s.opacity,
        });
        x = x.parentElement;
      }
      let bg = [255, 255, 255];
      for (const layer of [...layers].reverse())
        bg = over(parse(layer.color), bg);
      const s = getComputedStyle(e),
        fg = over(parse(s.color), bg);
      const lum = (c) =>
        c
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      const a = lum(fg),
        b = lum(bg);
      return {
        text: e.textContent.trim(),
        color: s.color,
        backgroundRGB: bg,
        foregroundRGB: fg,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        layers,
        opacity: s.opacity,
        rect: e.getBoundingClientRect().toJSON(),
        theme: document.documentElement.dataset.theme,
      };
    });
}
async function colors(theme) {
  const cx = await context(390, 900, theme),
    { p } = cx;
  try {
    await goto(p, "/produkt/hps-5w30");
    await p.locator(".series-line").scrollIntoViewIfNeeded();
    await p.waitForTimeout(1750);
    const pdp = await contrast(p, ".series-line");
    pdp.image = await shot(p, `contrast-pdp-${theme}.png`);
    check(
      `INNO-01-pdp-series-${theme}`,
      pdp.ratio >= 4.5 &&
        pdp.theme === theme &&
        pdp.layers.every((x) => Number(x.opacity) === 1 && x.image === "none"),
      pdp,
      "INNO-01",
    );
    const add = p.getByRole("button", {
      name: "Dodaj do koszyka",
      exact: true,
    });
    await add.click();
    const dialog = p
      .getByRole("dialog")
      .filter({ hasText: "Dodano do koszyka" });
    await dialog.waitFor();
    await p.waitForTimeout(1200);
    const popup = await contrast(p, 'dialog[open] span[class*="series"]');
    popup.image = await shot(p, `contrast-popup-${theme}.png`);
    check(
      `INNO-01-popup-series-${theme}`,
      popup.ratio >= 4.5 &&
        popup.theme === theme &&
        popup.layers.every(
          (x) => Number(x.opacity) === 1 && x.image === "none",
        ),
      popup,
      "INNO-01",
    );
    const stops = await dialog.locator("a[href],button:not(:disabled)").count();
    for (let i = 0; i < stops + 2; i++) {
      await p.keyboard.press("Tab");
      check(`popup-${theme}-Tab-${i}`, (await active(p)).dialog, {});
    }
    for (let i = 0; i < stops + 2; i++) {
      await p.keyboard.press("Shift+Tab");
      check(`popup-${theme}-ShiftTab-${i}`, (await active(p)).dialog, {});
    }
    await p.keyboard.press("Escape");
    await p.waitForTimeout(400);
    const restored = await active(p);
    check(
      `popup-${theme}-Escape-focus-restored`,
      (await p.locator("dialog[open]").count()) === 0 &&
        restored.text === "Dodaj do koszyka",
      { focus: restored },
    );
    await goto(p, "/katalog");
    const catalog = p.locator(".card .series").first();
    await catalog.scrollIntoViewIfNeeded();
    await p.waitForTimeout(1750);
    const row = await contrast(p, ".card .series");
    check(`catalog-series-${theme}`, row.ratio >= 4.5, row);
  } finally {
    await cx.close();
    save();
  }
}
async function notFound(route, label) {
  const cx = await context(390),
    { p } = cx;
  try {
    const response = await goto(p, route);
    const text = await p.locator("body").innerText();
    const main = p.locator("main");
    const mainCount = await main.count();
    const mainText = mainCount ? await main.innerText() : text;
    const catalog = mainCount
      ? await main.locator('a[href="/katalog"]').count()
      : 0;
    const image = await shot(p, `404-${label}.png`);
    const robotsMeta = await p
      .locator('meta[name="robots"]')
      .evaluateAll((es) => es.map((e) => e.getAttribute("content")));
    const robotsHeader = response.headers()["x-robots-tag"] || "";
    check(
      `404-${label}-robots-noindex`,
      /\bnoindex\b/i.test([robotsHeader, ...robotsMeta].join(" ")),
      { header: robotsHeader, meta: robotsMeta },
    );
    check(
      `INNO-03-${label}`,
      response.status() === 404 &&
        /nie znaleziono|nie istnieje|nie została znaleziona|nie możemy znaleźć|strona jest niedostępna/i.test(
          mainText,
        ) &&
        !text.includes("This page could not be found") &&
        catalog > 0,
      {
        status: response.status(),
        mainCount,
        mainText,
        text,
        catalogLinksInMain: catalog,
        image,
      },
      "INNO-03",
    );
    if (catalog > 0) {
      await main.locator('a[href="/katalog"]').first().click();
      await p.waitForURL(new URL("/katalog", base).href);
      check(
        `404-${label}-catalog-link`,
        p.url() === new URL("/katalog", base).href,
        { url: p.url() },
      );
    }
  } finally {
    await cx.close();
    save();
  }
}
async function programmaticMenu(width) {
  const cx = await context(width),
    { p } = cx;
  try {
    await goto(p, "/katalog");
    const start = await tabsUntil(p, (x) => x.burger);
    check(`menu-program-${width}-burger-reached`, start.found, {
      presses: start.presses,
    });
    await p.keyboard.press("Enter");
    await p.waitForTimeout(150);
    check(
      `menu-program-${width}-opened`,
      (await p.locator("button.burger").getAttribute("aria-expanded")) ===
        "true",
      {},
    );
    await p.locator('input[name="q"]').evaluate((e) => e.focus());
    await p.waitForTimeout(1750);
    const focus = await active(p);
    const image = await shot(p, `menu-program-focus-${width}.png`);
    check(
      `INNO-02-programmatic-search-${width}`,
      focus.name === "q" && visible(focus) && focus.menuExpanded === "false",
      {
        kind: "Actual input.focus(); does not modify focus styling or overlay DOM",
        focus,
        image,
      },
      "INNO-02",
    );
  } finally {
    await cx.close();
    save();
  }
}
async function b2bExact(width) {
  const cx = await context(width),
    { p } = cx;
  try {
    await goto(p, "/produkt/hps-5w30");
    const sequence = [];
    let found = false;
    for (let i = 0; i < 200; i++) {
      await p.keyboard.press("Tab");
      await p.waitForTimeout(350);
      const row = await active(p);
      sequence.push(row);
      if (row.footer && row.text === "Zostań dystrybutorem") {
        found = true;
        await p.waitForTimeout(1400);
        const focus = await active(p);
        const image = await shot(p, `footer-b2b-original-rhythm-${width}.png`);
        check(
          `INNO-04-b2b-original-rhythm-${width}`,
          visible(focus),
          {
            tabPresses: i + 1,
            priorTabSettleMs: 350,
            targetTabSettleMs: 1750,
            focus,
            sequence,
            image,
          },
          "INNO-04",
        );
        break;
      }
    }
    check(`footer-b2b-${width}-target-reached`, found, {
      bound: 200,
      presses: sequence.length,
    });
  } finally {
    await cx.close();
    save();
  }
}
async function footer(width, height = 900) {
  const cx = await context(width, height),
    { p } = cx;
  try {
    await goto(p, "/produkt/hps-5w30");
    const targetCount = await p
      .locator("footer.site a[href],footer.site button:not(:disabled)")
      .count();
    const rows = [];
    let enters = 0;
    for (let i = 0; i < 200; i++) {
      await p.keyboard.press("Tab");
      await p.waitForTimeout(40);
      let x = await active(p);
      if (x.footer) {
        enters++;
        await p.waitForTimeout(1710);
        x = await active(p);
        x.tabPresses = i + 1;
        rows.push(x);
        if (!visible(x))
          x.image = await shot(p, `footer-${width}x${height}-${enters}.png`);
        check(
          `INNO-04-footer-${width}x${height}-${enters}`,
          visible(x),
          x,
          "INNO-04",
        );
      } else if (enters) break;
    }
    check(
      `footer-${width}x${height}-all-controls-reached`,
      rows.length === targetCount,
      {
        reached: rows.length,
        expected: targetCount,
        footerB2B: rows.find((x) => x.text === "Zostań dystrybutorem") || null,
      },
    );
    // Native reverse traversal must also expose the footer controls after smooth scrolling settles.
    const reverse = [];
    for (let i = 0; i < Math.min(200, targetCount + 5); i++) {
      await p.keyboard.press("Shift+Tab");
      await p.waitForTimeout(40);
      let x = await active(p);
      if (x.footer) {
        await p.waitForTimeout(1710);
        x = await active(p);
        reverse.push(x);
        if (!visible(x))
          x.image = await shot(
            p,
            `footer-${width}x${height}-reverse-${reverse.length}.png`,
          );
        check(
          `footer-${width}x${height}-reverse-${reverse.length}`,
          visible(x),
          x,
        );
      } else if (reverse.length) break;
    }
    check(
      `footer-${width}x${height}-all-reverse-controls-reached`,
      reverse.length === targetCount,
      { reached: reverse.length, expected: targetCount },
    );
    const sticky = await p.locator(".sticky-buy").evaluate((e) => {
      const s = getComputedStyle(e);
      return {
        display: s.display,
        visibility: s.visibility,
        position: s.position,
        hidden: e.hasAttribute("data-hidden"),
        paddingBottom: s.paddingBottom,
        rect: e.getBoundingClientRect().toJSON(),
        viewport: { width: innerWidth, height: innerHeight },
        count: document.querySelectorAll(".sticky-buy").length,
      };
    });
    const screenshot = await shot(p, `footer-final-${width}x${height}.png`);
    check(
      `footer-${width}x${height}-purchase-bar-present`,
      sticky.count === 1 &&
        sticky.display !== "none" &&
        sticky.visibility === "visible" &&
        !sticky.hidden &&
        sticky.rect.bottom <= height + 1 &&
        sticky.rect.height > 0,
      { sticky, screenshot },
    );
  } finally {
    await cx.close();
    save();
  }
}
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: report.profile.executablePath,
  });
  report.browserVersion = browser.version();
  report.ownedProcessesAtLaunch = processes();
  watchdog = setTimeout(async () => {
    report.errors.push({ message: "Owned test watchdog exceeded 8 minutes" });
    save();
    await browser.close().catch(() => {});
  }, 480000);
  const health = await browser.newContext();
  try {
    const r = await health.request.get(new URL("/api/health", base).href);
    report.health = { status: r.status(), body: await r.json() };
    check(
      "public-health-200-ok",
      report.health.status === 200 && report.health.body?.status === "ok",
      report.health,
    );
  } finally {
    await health.close();
    report.contextsClosed++;
  }
  async function runCase(label, fn) {
    try {
      await fn();
    } catch (error) {
      report.errors.push({
        case: label,
        message: error.message,
        stack: error.stack,
      });
      save();
    }
  }
  const supplement = process.env.QA_SUPPLEMENT === "1";
  report.testScope = supplement
    ? "supplement-only: programmatic menu + both404 + original B2B rhythm"
    : "all four regressions and guards";
  if (!supplement)
    for (const width of [360, 390, 768])
      await runCase("menu-" + width, () => menu(width));
  for (const width of [360, 390, 768])
    await runCase("menu-program-" + width, () => programmaticMenu(width));
  if (!supplement)
    for (const theme of ["light", "dark"])
      await runCase("colors-" + theme, () => colors(theme));
  await runCase("404-product", () =>
    notFound("/produkt/QA-no-product-20261009", "product"),
  );
  await runCase("404-route", () => notFound("/QA-no-route-20261009", "route"));
  if (!supplement)
    for (const [w, h] of [
      [360, 900],
      [390, 900],
      [568, 320],
    ])
      await runCase("footer-" + w + "x" + h, () => footer(w, h));
  for (const width of [360, 390])
    await runCase("footer-b2b-original-rhythm-" + width, () => b2bExact(width));
  check("non-mutating-test-scope", report.forbiddenRequests.length === 0, {
    allowedMethods: ["GET", "HEAD", "OPTIONS"],
    forbiddenRequests: report.forbiddenRequests,
    closedPreviewProviderFlags:
      "Not observable in this browser suite. Require separate private runtime proof before/after deploy; do not infer from absent demo-bar.",
  });
} catch (error) {
  report.errors.push({ message: error.message, stack: error.stack });
} finally {
  clearTimeout(watchdog);
  if (browser)
    await browser
      .close()
      .then(() => {
        report.browserClosed = true;
      })
      .catch((error) =>
        report.errors.push({ message: "Close: " + error.message }),
      );
  report.finishedAt = new Date().toISOString();
  report.ownedProcessesAfterClose = processes();
  report.issues = ["INNO-02", "INNO-01", "INNO-03", "INNO-04"].map((id) => ({
    id,
    checks: checks.filter((x) => x.issue === id).length,
    failed: checks.filter((x) => x.issue === id && !x.pass).map((x) => x.id),
    pass:
      checks.filter((x) => x.issue === id).length > 0 &&
      checks.filter((x) => x.issue === id).every((x) => x.pass),
  }));
  report.failedGuards = checks
    .filter((x) => !x.issue && !x.pass)
    .map((x) => x.id);
  report.valid =
    report.errors.length === 0 &&
    report.forbiddenRequests.length === 0 &&
    report.browserClosed;
  report.expectationMet =
    report.valid &&
    (expectation === "before"
      ? report.testScope?.startsWith("supplement")
        ? report.issues
            .filter((x) => ["INNO-02", "INNO-03"].includes(x.id))
            .every((x) => x.failed.length > 0) &&
          report.failedGuards.length === 0
        : report.issues.every((x) => x.failed.length > 0)
      : (report.testScope?.startsWith("supplement")
          ? report.issues.filter((x) => x.checks > 0).every((x) => x.pass)
          : report.issues.every((x) => x.pass)) &&
        report.failedGuards.length === 0);
  save();
  console.log(
    JSON.stringify({
      out,
      expectation,
      valid: report.valid,
      expectationMet: report.expectationMet,
      issues: report.issues,
      failedGuards: report.failedGuards,
      errors: report.errors.map((x) => x.message),
      browserClosed: report.browserClosed,
    }),
  );
  process.exitCode = report.expectationMet ? 0 : 1;
}
