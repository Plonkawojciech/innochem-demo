import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const [baseArg, outArg, ...extra] = process.argv.slice(2);
assert(
  baseArg && outArg && !extra.length,
  "Usage: node tests/browser/theme-hydration.mjs <preview-or-local-base> <new-evidence-directory>",
);
const base = new URL(baseArg);
assert(
  ["http:", "https:"].includes(base.protocol) &&
    ["127.0.0.1", "localhost", "sklep-innochem.programo.pl"].includes(
      base.hostname,
    ) &&
    !base.username &&
    !base.password &&
    base.pathname === "/" &&
    !base.search &&
    !base.hash,
  "Only an isolated local store or the authorized preview origin is allowed",
);
const out = path.resolve(outArg);
await fs.mkdir(out); // Evidence is exclusive: never overwrite a previous attempt.
const playwrightModule =
  process.env.PLAYWRIGHT_MODULE ||
  (process.env.PLAYWRIGHT_ROOT &&
    path.join(process.env.PLAYWRIGHT_ROOT, "playwright")) ||
  "playwright";
const { chromium } = createRequire(import.meta.url)(playwrightModule);
const chromePath =
  process.env.CHROME_EXECUTABLE ||
  process.env.CHROME_PATH ||
  (process.platform === "linux"
    ? "/usr/bin/chromium"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const report = {
  startedAt: new Date().toISOString(),
  base: base.origin,
  sourceSha: null,
  sourceShaReason:
    "Browser-only test; a separate deployment receipt must bind the observed public chunks to source.",
  scope:
    "Theme behavior under a five-second app/layout GET delay, not a performance measurement.",
  profile: {
    headless: true,
    width: 390,
    height: 844,
    deviceScaleFactor: 1.75,
    isMobile: true,
    hasTouch: true,
    colorScheme: "light",
    latencyMs: 150,
    downloadKbps: 1600,
    uploadKbps: 750,
    cpuSlowdownMultiplier: 4,
  },
  chromePath,
  delayMs: 5000,
  errors: [],
  hydrationWarnings: [],
  forbiddenRequests: [],
  interceptionErrors: [],
  cases: [],
  contextsClosed: 0,
  browserClosed: false,
  pass: false,
};
let server;
let browser;
let child;
const openContexts = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`${label}_TIMEOUT`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    report.interrupted = signal;
    process.exitCode = 1;
    void server?.kill();
  });

async function snapshot(page) {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    storedTheme: localStorage.getItem("innochem-theme"),
    label: document
      .querySelector("button.theme-toggle")
      ?.getAttribute("aria-label"),
    readyState: document.readyState,
    events: window.__themeHydrationProbe.events,
    listeners: window.__themeHydrationProbe.listeners,
    dropped: window.__themeHydrationProbe.dropped,
  }));
}

async function runCase(routePath) {
  const row = {
    route: routePath,
    layoutRequests: [],
    actions: [],
    pass: false,
  };
  report.cases.push(row);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1.75,
    isMobile: true,
    hasTouch: true,
    colorScheme: "light",
    serviceWorkers: "block",
  });
  openContexts.add(context);
  try {
    await context.route("**/*", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const metadata = {
        method: req.method(),
        origin: url.origin,
        path: url.pathname,
      };
      const allowed =
        ["GET", "HEAD", "OPTIONS"].includes(req.method()) &&
        url.origin === base.origin;
      if (!allowed) report.forbiddenRequests.push(metadata);
      try {
        if (!allowed) return await route.abort("blockedbyclient");
        if (
          req.method() === "GET" &&
          /^\/_next\/static\/chunks\/app\/layout-[^/]+\.js$/.test(url.pathname)
        ) {
          assert(row.layoutRequests.length < 4, "Too many layout requests");
          const entry = {
            path: url.pathname,
            requestedAtEpochMs: Date.now(),
            releasedAtEpochMs: null,
          };
          row.layoutRequests.push(entry);
          await sleep(report.delayMs);
          entry.releasedAtEpochMs = Date.now();
          entry.actualDelayMs =
            entry.releasedAtEpochMs - entry.requestedAtEpochMs;
        }
        await route.continue();
      } catch {
        report.interceptionErrors.push(metadata);
      }
    });
    await context.addInitScript((origin) => {
      if (location.origin !== origin) return;
      localStorage.setItem("innochem-theme", "light");
      const probe = (window.__themeHydrationProbe = {
        events: [],
        listeners: [],
        dropped: 0,
      });
      const record = (entry) => {
        if (probe.events.length < 100)
          probe.events.push({ wallTime: Date.now(), ...entry });
        else probe.dropped++;
      };
      const add = document.addEventListener;
      // Record only listener metadata and forward registration unchanged. This
      // makes the prerequisite independent of a particular vendor chunk number.
      document.addEventListener = function (name, listener, options) {
        if (name === "click" && probe.listeners.length < 20)
          probe.listeners.push({
            capture:
              typeof options === "boolean" ? options : !!options?.capture,
            wallTime: Date.now(),
          });
        return add.call(this, name, listener, options);
      };
      // Install the diagnostic through the original method so it is not counted
      // as an application listener. Never cancel or generate an input event.
      add.call(
        document,
        "click",
        (event) => {
          if (!event.target?.closest?.("button.theme-toggle")) return;
          record({
            type: "click",
            trusted: event.isTrusted,
            targetTag: event.target.tagName,
          });
        },
        true,
      );
      new MutationObserver((mutations) => {
        for (const mutation of mutations)
          if (
            mutation.target === document.documentElement &&
            mutation.oldValue !== document.documentElement.dataset.theme
          )
            record({
              type: "theme-change",
              previous: mutation.oldValue,
              theme: document.documentElement.dataset.theme,
            });
      }).observe(document, {
        attributes: true,
        subtree: true,
        attributeOldValue: true,
        attributeFilter: ["data-theme"],
      });
    }, base.origin);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) =>
      report.errors.push({
        route: routePath,
        message: error.message.slice(0, 400),
      }),
    );
    page.on("console", (message) => {
      if (/hydration|hydrated|server rendered|mismatch/i.test(message.text()))
        report.hydrationWarnings.push({
          route: routePath,
          message: message.text().slice(0, 400),
        });
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1600 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const response = await page.goto(new URL(routePath, base).href, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    assert.equal(response.status(), 200, "Store page must return HTTP 200");
    row.status = response.status();
    await page.waitForFunction(() => {
      const registered = window.__themeHydrationProbe.listeners;
      return (
        registered.length >= 3 &&
        registered.some((x) => x.capture) &&
        registered.some((x) => !x.capture)
      );
    });
    assert(
      row.layoutRequests.some((x) => x.releasedAtEpochMs === null),
      "Layout blocking window elapsed before native input",
    );
    assert(
      await page
        .getByRole("button", { name: "Otwórz menu", exact: true })
        .isDisabled(),
      "Header must still await hydration before the first tap",
    );
    row.before = await snapshot(page);
    assert.equal(row.before.theme, "light");
    assert.equal(row.before.storedTheme, "light");
    const toggle = page.locator("button.theme-toggle");
    assert.equal(await toggle.count(), 1, "One native theme control required");

    async function action(name, expectedTheme, input) {
      const before = await snapshot(page);
      const actionRow = { name, expectedTheme };
      row.actions.push(actionRow);
      await input();
      const after = await snapshot(page);
      actionRow.state = after;
      actionRow.newEvents = after.events.slice(before.events.length);
      assert.equal(after.theme, expectedTheme, `${name}: DOM theme`);
      assert.equal(after.storedTheme, expectedTheme, `${name}: stored theme`);
      assert.equal(
        after.label,
        expectedTheme === "dark" ? "Włącz tryb jasny" : "Włącz tryb ciemny",
        `${name}: accessible label`,
      );
      const clicks = actionRow.newEvents.filter((e) => e.type === "click");
      const changes = actionRow.newEvents.filter(
        (e) => e.type === "theme-change",
      );
      assert.equal(clicks.length, 1, `${name}: exactly one native click`);
      assert(clicks[0].trusted, `${name}: trusted input required`);
      assert.equal(changes.length, 1, `${name}: exactly one theme change`);
      assert.equal(changes[0].theme, expectedTheme);
      return clicks[0];
    }

    const firstClick = await action("tap-during-hydration", "dark", () =>
      toggle.tap(),
    );
    await page.waitForLoadState("load", { timeout: 30000 });
    await page.waitForFunction(
      () => document.querySelector("button.burger")?.disabled === false,
    );
    await page.waitForTimeout(350);
    row.afterHydration = await snapshot(page);
    row.tapOccurredWhileLayoutBlocked = row.layoutRequests.some(
      (x) =>
        firstClick.wallTime >= x.requestedAtEpochMs &&
        x.releasedAtEpochMs !== null &&
        firstClick.wallTime < x.releasedAtEpochMs,
    );
    assert(
      row.tapOccurredWhileLayoutBlocked,
      "Tap must occur inside the actual delay",
    );
    assert(
      row.layoutRequests.length > 0 &&
        row.layoutRequests.every((x) => x.releasedAtEpochMs !== null),
      "All matching layout requests must finish before final assertions",
    );
    assert.equal(
      row.afterHydration.theme,
      "dark",
      "Hydration must retain the first toggle",
    );
    assert.equal(row.afterHydration.storedTheme, "dark");
    assert.equal(row.afterHydration.label, "Włącz tryb jasny");
    assert.equal(
      row.afterHydration.events.filter((e) => e.type === "click").length,
      1,
      "Hydration must not replay a second DOM click",
    );
    await action("tap-after-hydration", "light", () => toggle.tap());
    await toggle.focus();
    await action("native-enter", "dark", () => page.keyboard.press("Enter"));
    await action("native-space", "light", () => page.keyboard.press("Space"));
    const svgClick = await action("native-svg-tap", "dark", () =>
      toggle.locator("svg.theme-light").tap(),
    );
    assert(
      ["svg", "path", "circle"].includes(svgClick.targetTag.toLowerCase()),
      "SVG regression must hit a nested SVG node",
    );
    row.final = await snapshot(page);
    assert.equal(
      row.final.dropped,
      0,
      "Diagnostic event buffer must not overflow",
    );
    row.publicChunks = await page.evaluate(() =>
      [...document.scripts].map((x) => x.src).filter(Boolean),
    );
    await page.screenshot({
      path: path.join(
        out,
        routePath === "/" ? "home-dark.png" : "catalog-dark.png",
      ),
      timeout: 10000,
    });
    row.pass = true;
  } finally {
    await bounded(context.close(), 10000, "CONTEXT_CLOSE");
    openContexts.delete(context);
    report.contextsClosed++;
  }
}

try {
  server = await chromium.launchServer({
    executablePath: chromePath,
    headless: true,
    timeout: 15000,
    args: process.platform === "linux" ? ["--no-sandbox"] : [],
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR || os.tmpdir(),
      LANG: "C.UTF-8",
    },
  });
  child = server.process();
  report.chromePid = child.pid;
  browser = await chromium.connect(server.wsEndpoint(), { timeout: 15000 });
  report.browser = browser.version();
  await runCase("/");
  await runCase("/katalog");
  assert.deepEqual(
    report.forbiddenRequests,
    [],
    "Forbidden request invalidates the run",
  );
  assert.deepEqual(
    report.interceptionErrors,
    [],
    "Failed interception invalidates the run",
  );
  assert.deepEqual(report.errors, [], "Page errors invalidate the run");
  assert.deepEqual(
    report.hydrationWarnings,
    [],
    "Hydration warnings invalidate the run",
  );
  report.pass = true;
} catch (error) {
  report.failure = String(error.message || error).slice(0, 500);
  process.exitCode = 1;
} finally {
  try {
    for (const context of openContexts) {
      await bounded(context.close(), 10000, "LAST_CONTEXT_CLOSE");
      openContexts.delete(context);
      report.contextsClosed++;
    }
    if (browser)
      await bounded(browser.close(), 10000, "BROWSER_CLOSE").catch(() => {});
    if (server)
      await bounded(server.close(), 10000, "SERVER_CLOSE").catch(async () => {
        await bounded(server.kill(), 10000, "SERVER_KILL");
      });
    report.browserClosed =
      !child || child.exitCode !== null || child.signalCode !== null;
    assert(report.browserClosed, "Owned browser exit must be confirmed");
    assert.equal(openContexts.size, 0, "Owned contexts must close");
    assert.deepEqual(report.forbiddenRequests, [], "Final request guard");
    assert.deepEqual(report.interceptionErrors, [], "Final interception guard");
    assert.deepEqual(report.errors, [], "Final page error guard");
    assert.deepEqual(
      report.hydrationWarnings,
      [],
      "Final hydration warning guard",
    );
  } catch (error) {
    report.cleanupFailure = String(error.message || error).slice(0, 500);
    report.pass = false;
    process.exitCode = 1;
    if (server)
      await bounded(server.kill(), 10000, "LAST_SERVER_KILL").catch(() => {});
    report.browserClosed =
      !child || child.exitCode !== null || child.signalCode !== null;
  } finally {
    report.stoppedAt = new Date().toISOString();
    await fs.writeFile(
      path.join(out, "report.json"),
      JSON.stringify(report, null, 2),
    );
  }
}
console.log(
  JSON.stringify({
    pass: report.pass,
    casesPassed: report.cases.filter((x) => x.pass).length,
    contextsClosed: report.contextsClosed,
    browserClosed: report.browserClosed,
  }),
);
