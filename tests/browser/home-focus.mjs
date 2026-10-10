import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Standalone native regression. Importing this module never starts a browser.
let report, out;
function check(id, condition, data) {
  report.checks.push({ id, pass: Boolean(condition), data });
  return Boolean(condition);
}
async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(label + "_TIMEOUT")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function requestDecision(event, allowedOrigin) {
  let url;
  try {
    url = new URL(event.request?.url);
  } catch {
    return {
      allowed: false,
      reason: "MALFORMED_URL",
      method: event.request?.method || null,
      path: null,
      origin: null,
    };
  }
  const metadata = {
    method: event.request?.method || null,
    origin: url.origin,
    path: url.pathname,
    redirected: Boolean(event.redirectedRequestId),
    stage:
      event.responseStatusCode !== undefined ||
      event.responseErrorReason !== undefined
        ? "Response"
        : "Request",
  };
  if (metadata.stage !== "Request")
    return { allowed: false, reason: "UNEXPECTED_RESPONSE_STAGE", ...metadata };
  const allowed =
    ["GET", "HEAD", "OPTIONS"].includes(metadata.method) &&
    url.origin === allowedOrigin &&
    !url.username &&
    !url.password;
  return { allowed, reason: allowed ? null : "METHOD_OR_ORIGIN", ...metadata };
}

export function createReadOnlyGuardian(
  client,
  origin,
  { onForbidden, onError, onCleanupError } = {},
) {
  const pending = new Set();
  let installed = false,
    closing = false,
    disposed = false;
  const listener = (event) => {
    const operation = (async () => {
      const decision = requestDecision(event, origin);
      if (!decision.allowed) onForbidden?.(decision);
      try {
        await client.send(
          decision.allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
          decision.allowed
            ? { requestId: event.requestId }
            : { requestId: event.requestId, errorReason: "BlockedByClient" },
        );
      } catch {
        const metadata = { ...decision, reason: "FETCH_COMMAND_FAILED" };
        (closing ? onCleanupError : onError)?.(metadata);
        // A failed continuation never falls back to unguarded navigation.
        if (decision.allowed)
          await client
            .send("Fetch.failRequest", {
              requestId: event.requestId,
              errorReason: "BlockedByClient",
            })
            .catch(() => {});
      }
    })();
    pending.add(operation);
    void operation
      .finally(() => pending.delete(operation))
      .catch(() => onError?.({ reason: "GUARD_HANDLER_FAILED" }));
  };
  return {
    async enable() {
      assert(!installed && !disposed, "Guardian cannot be enabled twice");
      client.on("Fetch.requestPaused", listener);
      try {
        await client.send("Fetch.enable", {
          patterns: [{ urlPattern: "*", requestStage: "Request" }],
        });
        installed = true;
      } catch (error) {
        client.off("Fetch.requestPaused", listener);
        throw error;
      }
    },
    beginClose() {
      closing = true;
    },
    async dispose({ targetClosed = false } = {}) {
      if (disposed) return { alreadyDisposed: true };
      closing = true;
      await Promise.allSettled([...pending]);
      const result = {
        pendingAfterDrain: pending.size,
        targetClosed,
        fetchDisabled: false,
        detached: false,
      };
      const closedError = (error) =>
        targetClosed &&
        /Target closed|Session closed|Target page, context or browser has been closed|session has been closed|Session with given id not found|target.*closed/i.test(
          String(error.message || error),
        );
      try {
        await client.send("Fetch.disable");
        result.fetchDisabled = true;
      } catch (error) {
        if (!closedError(error)) throw error;
        result.fetchDisabled = "target-closed";
      }
      client.off("Fetch.requestPaused", listener);
      try {
        await client.detach();
        result.detached = true;
      } catch (error) {
        if (!closedError(error)) throw error;
        result.detached = "target-closed";
      }
      disposed = true;
      return result;
    },
    async drain() {
      await Promise.allSettled([...pending]);
    },
  };
}

async function frames(page, count = 3) {
  await page.evaluate(
    (count) =>
      new Promise((resolve) => {
        const frame = () => {
          if (--count <= 0) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    count,
  );
}
async function noOverflow(page, label) {
  const sizes = await page.evaluate(() => ({
    innerWidth,
    clientWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  check(
    label + "-no-horizontal-overflow",
    sizes.documentWidth <= sizes.clientWidth + 1 &&
      sizes.bodyWidth <= sizes.clientWidth + 1,
    sizes,
  );
}
async function settledSection(page, id) {
  const section = page.locator("#" + id);
  await section.waitFor({ state: "visible" });
  await page.waitForFunction(
    (id) => {
      const section = document.getElementById(id);
      if (!section) return false;
      const roots = [section, ...section.querySelectorAll(".rv")];
      return roots.every((el) => {
        const css = getComputedStyle(el);
        return (
          (!el.classList.contains("rv") || el.classList.contains("in")) &&
          Number(css.opacity) >= 0.999 &&
          css.visibility === "visible"
        );
      });
    },
    id,
    { timeout: 20000 },
  );
  await page.evaluate(async (id) => {
    await document.fonts.ready;
    await Promise.all(
      [...document.getElementById(id).querySelectorAll("img")].map(
        async (image) => {
          if (!image.complete)
            await new Promise((resolve, reject) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener(
                "error",
                () => reject(Error("SECTION_IMAGE_FAILED")),
                { once: true },
              );
            });
          if (!image.naturalWidth) throw Error("SECTION_IMAGE_FAILED");
          if (image.decode) await image.decode();
        },
      ),
    );
  }, id);
  await frames(page);
  // Geometry stability waits for a real layout state rather than a fixed sleep.
  await page.waitForFunction(
    (id) => {
      const el = document.getElementById(id),
        box = el.getBoundingClientRect();
      const value = [box.x, box.y + scrollY, box.width, box.height]
        .map((x) => x.toFixed(2))
        .join(",");
      const key = "__cvGeometry_" + id,
        previous = window[key];
      window[key] = {
        value,
        frames: previous?.value === value ? previous.frames + 1 : 0,
      };
      return window[key].frames >= 3;
    },
    id,
    { polling: "raf", timeout: 10000 },
  );
  return section;
}
async function headingVisible(page, id, label) {
  const data = await page.locator("#" + id + " h2").evaluate((el) => {
    const box = el.getBoundingClientRect(),
      css = getComputedStyle(el);
    const x = box.x + box.width / 2,
      y = Math.max(0, box.y) + Math.min(box.height / 2, 20);
    const hit = document.elementFromPoint(x, y);
    return {
      text: el.textContent.trim(),
      rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      viewport: { width: innerWidth, height: innerHeight },
      opacity: css.opacity,
      hit: Boolean(hit && (el.contains(hit) || hit.contains(el))),
      visibility: css.visibility,
    };
  });
  check(
    label + "-heading-visible",
    data.text &&
      data.rect.y >= 0 &&
      data.rect.y + data.rect.height <= data.viewport.height &&
      Number(data.opacity) >= 0.999 &&
      data.visibility === "visible" &&
      data.hit,
    data,
  );
}
async function nativeWheelTo(page, id, row) {
  for (let step = 0; step < 32; step++) {
    const state = await page.locator("#" + id).evaluate((section) => {
      const root = section.querySelector(".feature") || section,
        box = root.getBoundingClientRect();
      // Do not measure skipped descendants before native scrolling reaches the root.
      const near = box.top < innerHeight - 150 && box.bottom > 150;
      const target = near
        ? section.querySelector("h2").getBoundingClientRect()
        : box;
      return {
        top: target.top,
        bottom: target.bottom,
        height: innerHeight,
        near,
        scrollY,
        maxScrollY: document.documentElement.scrollHeight - innerHeight,
      };
    });
    if (state.near && state.top >= 100 && state.bottom <= state.height - 100)
      break;
    const delta =
      state.top < 100
        ? -Math.max(20, Math.min(450, 100 - state.top))
        : Math.max(20, Math.min(630, state.top - 100));
    assert(
      !(delta > 0 && state.scrollY >= state.maxScrollY - 1),
      "NATIVE_SCROLL_CANNOT_REACH_" + id,
    );
    await page.mouse.wheel(0, delta);
    await page.waitForFunction(
      (before) => Math.abs(scrollY - before) > 0.5,
      state.scrollY,
      { polling: "raf", timeout: 10000 },
    );
    await page.waitForFunction(
      () => {
        const previous = window.__cvWheelState;
        window.__cvWheelState = {
          y: scrollY,
          frames: previous?.y === scrollY ? previous.frames + 1 : 0,
        };
        return window.__cvWheelState.frames >= 3;
      },
      null,
      { polling: "raf", timeout: 10000 },
    );
    row.wheels.push({ id, step, delta, beforeScrollY: state.scrollY });
    if (step === 31) throw Error("NATIVE_SCROLL_STEP_LIMIT_" + id);
  }
  await settledSection(page, id);
  await headingVisible(page, id, row.name + "-" + id);
}

// Same three-frame viewport/hitpoint/outline rule as the frozen CV regression,
// strengthened to require the entire focus ring below the actual sticky header.
export function focusIsVisible(data, expected) {
  const margin = Math.max(0, data.outline.offset) + data.outline.width;
  return (
    data.index === expected &&
    data.focusVisible &&
    !data.hidden &&
    data.opacity >= 0.999 &&
    data.header.sticky &&
    data.rect.x - margin >= 0 &&
    data.rect.y - margin >= Math.max(0, data.header.bottom) &&
    data.rect.right + margin <= data.viewport.width + 1 &&
    data.rect.bottom + margin <= data.viewport.height + 1 &&
    data.hits.length === 3 &&
    data.hits.every(Boolean) &&
    data.outline.style !== "none" &&
    data.outline.width >= 1 &&
    !/rgba\([^)]*,\s*0\)$/.test(data.outline.color)
  );
}
async function focusProof(page, row, label) {
  await frames(page);
  const data = await page.evaluate(() => {
    const el = document.activeElement,
      b = el.getBoundingClientRect(),
      css = getComputedStyle(el);
    const points = [
      [b.x + b.width / 2, b.y + b.height / 2],
      [b.x + Math.min(6, b.width / 3), b.y + Math.min(6, b.height / 3)],
      [
        b.right - Math.min(6, b.width / 3),
        b.bottom - Math.min(6, b.height / 3),
      ],
    ];
    const hits = points.map(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && el.contains(hit));
    });
    const links = [...document.querySelectorAll("#produkt a[href]")];
    let ancestor = el,
      opacity = 1,
      hidden = false;
    while (ancestor instanceof HTMLElement) {
      const style = getComputedStyle(ancestor);
      opacity *= Number(style.opacity);
      hidden ||= style.visibility !== "visible" || style.display === "none";
      ancestor = ancestor.parentElement;
    }
    const header = document.querySelector("header.site"),
      hb = header?.getBoundingClientRect();
    const headerPosition = header && getComputedStyle(header).position;
    return {
      index: links.indexOf(el),
      text: el.textContent.replace(/\s+/g, " ").trim(),
      href: el.getAttribute("href"),
      rect: {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        right: b.right,
        bottom: b.bottom,
      },
      viewport: { width: innerWidth, height: innerHeight },
      hits,
      focusVisible: el.matches(":focus-visible"),
      outline: {
        style: css.outlineStyle,
        width: parseFloat(css.outlineWidth),
        offset: parseFloat(css.outlineOffset),
        color: css.outlineColor,
      },
      opacity,
      hidden,
      header: {
        sticky: ["sticky", "fixed"].includes(headerPosition),
        bottom: hb?.bottom ?? null,
      },
      scrollY,
      rootScrollBehavior: getComputedStyle(document.documentElement)
        .scrollBehavior,
      rootScrollPaddingTop: getComputedStyle(document.documentElement)
        .scrollPaddingTop,
    };
  });
  const expected = row.expected;
  const passed = check(
    label + "-native-focus-visible",
    focusIsVisible(data, expected),
    { ...data, expected },
  );
  row.focus.push({ label, expected, pass: passed, ...data });
  await page.screenshot({
    path: path.join(out, label + ".png"),
    animations: "disabled",
    timeout: 10000,
  });
  return data.index;
}
async function keyboardAcceptance(page, row) {
  const count = await page.locator("#produkt a[href]").count();
  check(row.name + "-featured-links-exist", count === 7, { count });
  assert(count === 7, "EXACT_SEVEN_FEATURED_LINKS_REQUIRED");
  for (const reverse of [false, true]) {
    const setup = await page.evaluate((reverse) => {
      const controls = [
        ...document.querySelectorAll(
          "a[href],button,input,select,textarea,[tabindex]",
        ),
      ].filter((el) => {
        const css = getComputedStyle(el);
        return (
          el.tabIndex >= 0 &&
          !el.disabled &&
          !el.closest("[inert]") &&
          css.display !== "none" &&
          css.visibility === "visible" &&
          el.getBoundingClientRect().width > 0
        );
      });
      const target = [...document.querySelectorAll("#produkt a[href]")],
        boundary = reverse ? target.at(-1) : target[0];
      const index = controls.indexOf(boundary),
        start = controls[index + (reverse ? 1 : -1)];
      if (!start || start.closest("#produkt"))
        throw Error("OUTSIDE_TAB_STARTER_NOT_FOUND");
      start.focus();
      return {
        starter: start.tagName,
        href: start.getAttribute("href"),
        targetCount: target.length,
      };
    }, reverse);
    row.focusPreparation.push({ reverse, ...setup });
    for (let step = 0; step < count; step++) {
      await page.keyboard.press(reverse ? "Shift+Tab" : "Tab");
      const expected = reverse ? count - 1 - step : step;
      row.expected = expected;
      const actual = await focusProof(
        page,
        row,
        row.name + (reverse ? "-reverse-" : "-forward-") + step,
      );
      check(
        row.name + "-focus-order-" + reverse + "-" + step,
        actual === expected,
        { actual, expected },
      );
    }
  }
}

const securityArrays = [
  "errors",
  "hydrationWarnings",
  "httpFailures",
  "forbiddenRequests",
  "interceptionErrors",
  "cleanupFetchErrors",
];
export function caseIsValid(row, checks) {
  return (
    !row.failure &&
    row.contextClosed &&
    row.guardInstalledBeforeGoto &&
    row.guardCleanup?.targetClosed === true &&
    row.guardCleanup?.pendingAfterDrain === 0 &&
    Boolean(row.guardCleanup?.detached) &&
    row.focus.length === 14 &&
    row.focus.every((item) => item.pass) &&
    securityArrays.every(
      (key) => Array.isArray(row[key]) && row[key].length === 0,
    ) &&
    checks
      .filter((item) => item.id.startsWith(row.name + "-"))
      .every((item) => item.pass)
  );
}

async function run(baseArgument, outArgument, expectedBuild) {
  const base = new URL(baseArgument);
  assert(
    !base.username &&
      !base.password &&
      base.pathname === "/" &&
      !base.search &&
      !base.hash &&
      ((base.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(base.hostname)) ||
        base.origin === "https://sklep-innochem.programo.pl"),
    "Only localhost or the authorized preview origin is allowed",
  );
  assert(
    /^[A-Za-z0-9_-]{1,128}$/.test(expectedBuild || ""),
    "Expected public build ID required",
  );
  out = path.resolve(outArgument);
  await fs.mkdir(out); // Exclusive public evidence directory.
  const require = createRequire(import.meta.url);
  const modulePath =
    process.env.PLAYWRIGHT_MODULE ||
    (process.env.PLAYWRIGHT_ROOT &&
      path.join(process.env.PLAYWRIGHT_ROOT, "playwright")) ||
    "playwright";
  const { chromium } = require(modulePath);
  const chromePath =
    process.env.CHROME_EXECUTABLE ||
    process.env.CHROME_PATH ||
    (process.platform === "linux"
      ? "/usr/bin/chromium"
      : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  report = {
    startedAt: new Date().toISOString(),
    base: base.origin,
    expectedBuild,
    sourceSHA: null,
    sourceBindingLimit:
      "Bind the observed public build to the source/image using a separate deployment receipt.",
    profile: {
      widths: [320, 412, 900, 1440],
      height: 900,
      DPR: 1.75,
      colorScheme: "light",
      reducedMotion: "no-preference",
    },
    scope:
      "All7forward+7reverse native links per width. Original3rAF; no CSS overrides, delayed settlement, Enter, localStorage or account changes.",
    limits: { totalMs: 240000, caseMs: 60000 },
    cases: [],
    checks: [],
    browserProcesses: [],
    contextsClosed: 0,
    browserClosed: false,
    pass: false,
  };
  let server,
    browser,
    child,
    context,
    currentRow,
    interrupted = false,
    timedOut = false;
  const deadline = Date.now() + report.limits.totalMs;
  const remaining = () => {
    assert(!interrupted && !timedOut && Date.now() < deadline, "RUN_TERMINAL");
    return deadline - Date.now();
  };
  const stop = (signal) => {
    interrupted = true;
    report.interrupted = signal;
    void server?.kill();
  };
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
  const watchdog = setTimeout(() => {
    timedOut = true;
    void server?.kill();
  }, report.limits.totalMs);
  try {
    for (const width of report.profile.widths) {
      remaining();
      server = await chromium.launchServer({
        executablePath: chromePath,
        headless: true,
        timeout: 15000,
        args: ["--no-sandbox"],
        env: {
          PATH: process.env.PATH || "/usr/bin:/bin",
          HOME: os.tmpdir(),
          TMPDIR: os.tmpdir(),
          LANG: "C.UTF-8",
        },
      });
      child = server.process();
      const profile = child.spawnargs
        .find((arg) => arg.startsWith("--user-data-dir="))
        ?.slice("--user-data-dir=".length);
      assert(
        profile?.startsWith(
          path.join(os.tmpdir(), "playwright_chromiumdev_profile-"),
        ),
        "Owned ephemeral profile not identified",
      );
      const processRow = {
        width,
        pid: child.pid,
        profile,
        ownedLaunch: true,
        closed: false,
        profileRemoved: false,
      };
      report.browserProcesses.push(processRow);
      browser = await chromium.connect(server.wsEndpoint(), { timeout: 15000 });
      report.browserVersion = browser.version();
      const row = (currentRow = {
        name: "w" + width,
        width,
        passed: false,
        focus: [],
        focusPreparation: [],
        wheels: [],
        errors: [],
        hydrationWarnings: [],
        httpFailures: [],
        forbiddenRequests: [],
        interceptionErrors: [],
        cleanupFetchErrors: [],
        contextClosed: false,
      });
      report.cases.push(row);
      let guardian;
      try {
        context = await browser.newContext({
          viewport: { width, height: 900 },
          deviceScaleFactor: 1.75,
          colorScheme: "light",
          reducedMotion: "no-preference",
          isMobile: width <= 412,
          hasTouch: width <= 412,
          serviceWorkers: "block",
        });
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        page.on("pageerror", (error) =>
          row.errors.push(String(error.message).slice(0, 300)),
        );
        page.on("console", (message) => {
          if (
            /hydration|hydrated|server rendered|mismatch/i.test(message.text())
          )
            row.hydrationWarnings.push(message.text().slice(0, 300));
        });
        page.on("response", (response) => {
          if (response.status() >= 400) {
            const url = new URL(response.url());
            row.httpFailures.push({
              origin: url.origin,
              path: url.pathname,
              status: response.status(),
            });
          }
        });
        const cdp = await context.newCDPSession(page);
        guardian = createReadOnlyGuardian(cdp, base.origin, {
          onForbidden: (m) => row.forbiddenRequests.push(m),
          onError: (m) => row.interceptionErrors.push(m),
          onCleanupError: (m) => row.cleanupFetchErrors.push(m),
        });
        await guardian.enable();
        row.guardInstalledBeforeGoto = true;
        await bounded(
          (async () => {
            await page.goto(base.origin + "/", {
              waitUntil: "domcontentloaded",
              timeout: 45000,
            });
            const builds = await page.evaluate(() => {
              const payload = [...document.querySelectorAll("script")]
                .flatMap((script) => {
                  const match = script.textContent.match(
                    /^self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)$/,
                  );
                  return match ? [JSON.parse(match[1])] : [];
                })
                .join("");
              return [
                ...new Set(
                  [...payload.matchAll(/"b"\s*:\s*"([A-Za-z0-9_-]+)"/g)].map(
                    (match) => match[1],
                  ),
                ),
              ];
            });
            assert(
              builds.length === 1 && builds[0] === expectedBuild,
              "PUBLIC_BUILD_NOT_BOUND",
            );
            row.observedBuildId = builds[0];
            await page.waitForFunction(() => {
              const button = document.querySelector("button.burger");
              return button && !button.disabled;
            });
            assert(
              (await page.getByRole("dialog").count()) === 0,
              "MODAL_INVALIDATES_NON_WRITING_FOCUS_PROBE",
            );
            await noOverflow(page, row.name + "-initial");
            for (const id of ["technologia", "produkt"])
              await nativeWheelTo(page, id, row);
            await keyboardAcceptance(page, row);
            await noOverflow(page, row.name + "-final");
            await guardian.drain();
            row.preClosurePass =
              row.focus.length === 14 &&
              row.focus.every((item) => item.pass) &&
              [
                "errors",
                "hydrationWarnings",
                "httpFailures",
                "forbiddenRequests",
                "interceptionErrors",
              ].every((key) => row[key].length === 0) &&
              report.checks
                .filter((item) => item.id.startsWith(row.name + "-"))
                .every((item) => item.pass);
          })(),
          Math.min(report.limits.caseMs, remaining()),
          "HOME_FOCUS_CASE",
        );
      } catch (error) {
        row.failure = String(error.message || error).slice(0, 300);
        row.passed = false;
      } finally {
        guardian?.beginClose();
        if (context) {
          await bounded(context.close(), 10000, "CONTEXT_CLOSE");
          context = undefined;
          row.contextClosed = true;
          report.contextsClosed++;
        }
        if (guardian)
          row.guardCleanup = await bounded(
            guardian.dispose({ targetClosed: true }),
            5000,
            "GUARD_CLOSE",
          );
        await bounded(browser.close(), 10000, "BROWSER_CLOSE");
        browser = undefined;
        await bounded(server.close(), 10000, "SERVER_CLOSE");
        processRow.closed =
          child.exitCode !== null || child.signalCode !== null;
        processRow.profileRemoved = await fs.access(profile).then(
          () => false,
          (error) => {
            if (error.code === "ENOENT") return true;
            throw error;
          },
        );
        assert(
          processRow.closed && processRow.profileRemoved,
          "OWNED_BROWSER_PROFILE_CLOSURE_NOT_CONFIRMED",
        );
        server = undefined;
        child = undefined;
      }
      // Fetch handlers and page events may finish while closing the target.
      // No cleanup cancellation or unknown error is exempt from the zero rule.
      row.passed = caseIsValid(row, report.checks);
      await fs.writeFile(
        path.join(out, "report.json"),
        JSON.stringify(report, null, 2) + "\n",
      );
    }
    report.pass =
      report.cases.length === 4 &&
      report.cases.every((row) => caseIsValid(row, report.checks)) &&
      report.checks.every((item) => item.pass) &&
      report.cases.reduce((sum, row) => sum + row.focus.length, 0) === 56;
  } catch (error) {
    report.failure = String(error.message || error).slice(0, 300);
    report.failedCase = currentRow?.name;
    report.pass = false;
  } finally {
    clearTimeout(watchdog);
    for (const signal of ["SIGINT", "SIGTERM"])
      process.removeListener(signal, stop);
    if (context)
      await bounded(context.close(), 5000, "FINAL_CONTEXT_CLOSE").catch(
        () => {},
      );
    if (browser)
      await bounded(browser.close(), 5000, "FINAL_BROWSER_CLOSE").catch(
        () => {},
      );
    if (server) {
      await bounded(server.close(), 5000, "FINAL_SERVER_CLOSE").catch(
        async () => {
          await bounded(server.kill(), 5000, "FINAL_SERVER_KILL");
        },
      );
      const own = report.browserProcesses.at(-1);
      if (own) {
        own.closed = child.exitCode !== null || child.signalCode !== null;
        own.profileRemoved = await fs.access(own.profile).then(
          () => false,
          (error) => {
            if (error.code === "ENOENT") return true;
            throw error;
          },
        );
      }
    }
    report.browserClosed =
      report.browserProcesses.length > 0 &&
      report.browserProcesses.every((row) => row.closed && row.profileRemoved);
    report.timedOut = timedOut || Date.now() >= deadline;
    report.cancelled = interrupted;
    for (const row of report.cases)
      row.passed = caseIsValid(row, report.checks);
    report.pass &&=
      report.browserClosed &&
      !report.timedOut &&
      !report.cancelled &&
      report.cases.every((row) => caseIsValid(row, report.checks));
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(
      path.join(out, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    if (!report.timedOut && Date.now() >= deadline) {
      report.timedOut = true;
      report.pass = false;
      await fs.writeFile(
        path.join(out, "report.json"),
        JSON.stringify(report, null, 2) + "\n",
      );
    }
  }
  console.log(
    JSON.stringify({
      pass: report.pass,
      focusChecks: report.cases.reduce((sum, row) => sum + row.focus.length, 0),
      contextsClosed: report.contextsClosed,
      browserClosed: report.browserClosed,
      report: path.join(out, "report.json"),
    }),
  );
  if (!report.pass) process.exitCode = 1;
}

async function selfTest() {
  const data = {
    index: 4,
    focusVisible: true,
    hidden: false,
    opacity: 1,
    header: { sticky: true, bottom: 73 },
    rect: { x: 43, y: 80, right: 121, bottom: 130 },
    viewport: { width: 320, height: 900 },
    hits: [true, true, true],
    outline: { offset: 3, width: 2, style: "solid", color: "rgb(76, 47, 214)" },
  };
  assert.equal(focusIsVisible(data, 4), true);
  assert.equal(
    focusIsVisible(
      {
        ...data,
        rect: { ...data.rect, y: -0.375, bottom: 49.421875 },
        hits: [false, false, false],
      },
      4,
    ),
    false,
    "Recorded5W30occludedbyheader",
  );
  assert.equal(
    focusIsVisible(
      {
        ...data,
        rect: { ...data.rect, y: 1849, bottom: 1899 },
        hits: [false, false, false],
      },
      4,
    ),
    false,
    "Recordedoffscreen10W40",
  );
  assert.equal(
    focusIsVisible({ ...data, rect: { ...data.rect, y: 76 } }, 4),
    false,
    "Completeoutline mustclearheader",
  );
  assert.equal(
    focusIsVisible({ ...data, hits: [true, false, true] }, 4),
    false,
  );
  assert.equal(
    focusIsVisible({ ...data, rect: { ...data.rect, x: 4 } }, 4),
    false,
  );
  assert.equal(focusIsVisible(data, 3), false);
  const origin = "https://sklep-innochem.programo.pl";
  assert.equal(
    requestDecision({ request: { method: "GET", url: origin + "/" } }, origin)
      .allowed,
    true,
  );
  assert.equal(
    requestDecision(
      { request: { method: "POST", url: origin + "/api/test" } },
      origin,
    ).allowed,
    false,
  );
  assert.equal(
    requestDecision(
      {
        request: { method: "GET", url: "https://example.com/" },
        redirectedRequestId: "previous",
      },
      origin,
    ).allowed,
    false,
  );
  assert.equal(
    requestDecision({ request: { method: "GET", url: "malformed" } }, origin)
      .allowed,
    false,
  );
  assert.equal(
    requestDecision(
      {
        request: { method: "GET", url: origin + "/" },
        responseStatusCode: 200,
      },
      origin,
    ).allowed,
    false,
  );
  assert.equal(
    requestDecision(
      {
        request: {
          method: "GET",
          url: "https://user:pass@sklep-innochem.programo.pl/",
        },
      },
      origin,
    ).allowed,
    false,
  );
  const validCase = () => ({
    name: "fixture",
    focus: Array.from({ length: 14 }, () => ({ pass: true })),
    contextClosed: true,
    guardInstalledBeforeGoto: true,
    guardCleanup: { targetClosed: true, pendingAfterDrain: 0, detached: true },
    passed: true,
    preClosurePass: true,
    ...Object.fromEntries(securityArrays.map((key) => [key, []])),
  });
  const checks = [{ id: "fixture-focus", pass: true }];
  for (const key of securityArrays) {
    const row = validCase();
    assert.equal(caseIsValid(row, checks), true);
    row[key].push({ reason: "LATE_AFTER_PRE_CLOSURE_PASS" });
    assert.equal(
      caseIsValid(row, checks),
      false,
      key + " must be reread after closure",
    );
  }
  class FakeCDP {
    constructor({
      rejectContinuation = false,
      blockContinuation = false,
    } = {}) {
      this.rejectContinuation = rejectContinuation;
      this.blockContinuation = blockContinuation;
      this.commands = [];
      this.blocked = new Promise((resolve) => {
        this.release = resolve;
      });
    }
    on(name, listener) {
      assert.equal(name, "Fetch.requestPaused");
      this.listener = listener;
    }
    off(name, listener) {
      assert.equal(this.listener, listener);
      this.listener = undefined;
    }
    async send(name, args) {
      this.commands.push({ name, args });
      if (name === "Fetch.continueRequest") {
        if (this.blockContinuation) await this.blocked;
        if (this.rejectContinuation)
          throw Error("UNKNOWN_CONTINUATION_FAILURE");
      }
      return {};
    }
    async detach() {
      this.detached = true;
    }
    emit(request) {
      this.listener({ requestId: "owned-fixture", request });
    }
  }
  const guardedFixture = async (options) => {
    const row = validCase(),
      client = new FakeCDP(options);
    const guardian = createReadOnlyGuardian(client, origin, {
      onForbidden: (metadata) => row.forbiddenRequests.push(metadata),
      onError: (metadata) => row.interceptionErrors.push(metadata),
      onCleanupError: (metadata) => row.cleanupFetchErrors.push(metadata),
    });
    await guardian.enable();
    return { row, client, guardian };
  };
  const lateForbidden = await guardedFixture();
  assert.equal(caseIsValid(lateForbidden.row, checks), true);
  lateForbidden.client.emit({ method: "POST", url: origin + "/api/test" });
  await lateForbidden.guardian.drain();
  lateForbidden.row.guardCleanup = await lateForbidden.guardian.dispose({
    targetClosed: true,
  });
  assert.equal(caseIsValid(lateForbidden.row, checks), false);
  assert(
    lateForbidden.client.commands.some(
      (command) => command.name === "Fetch.failRequest",
    ),
  );

  const cleanupError = await guardedFixture({ rejectContinuation: true });
  assert.equal(caseIsValid(cleanupError.row, checks), true);
  cleanupError.guardian.beginClose();
  cleanupError.client.emit({ method: "GET", url: origin + "/" });
  await cleanupError.guardian.drain();
  cleanupError.row.guardCleanup = await cleanupError.guardian.dispose({
    targetClosed: true,
  });
  assert.equal(cleanupError.row.cleanupFetchErrors.length, 1);
  assert.equal(
    caseIsValid(cleanupError.row, checks),
    false,
    "Unknown cleanup errors are never exempt",
  );

  const cleanupTimeout = await guardedFixture({ blockContinuation: true });
  cleanupTimeout.client.emit({ method: "GET", url: origin + "/" });
  const closing = cleanupTimeout.guardian.dispose({ targetClosed: true });
  await assert.rejects(
    bounded(closing, 5, "GUARD_CLOSE"),
    /GUARD_CLOSE_TIMEOUT/,
  );
  cleanupTimeout.row.failure = "GUARD_CLOSE_TIMEOUT";
  cleanupTimeout.client.release();
  cleanupTimeout.row.guardCleanup = await closing;
  assert.equal(
    caseIsValid(cleanupTimeout.row, checks),
    false,
    "Late cleanup completion cannot clear timeout",
  );
  await assert.rejects(
    bounded(new Promise(() => {}), 5, "CONTEXT_CLOSE"),
    /CONTEXT_CLOSE_TIMEOUT/,
  );
  const incomplete = validCase();
  incomplete.contextClosed = false;
  assert.equal(caseIsValid(incomplete, checks), false);
  console.log(
    "Pure focus, late-event guard and cleanup timeout regressions passed; no browser or HTTP started",
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--self-test") await selfTest();
  else {
    assert(
      args.length === 3,
      "Usage: node tests/browser/home-focus.mjs BASE NEW_OUTPUT EXPECTED_BUILD_ID",
    );
    await run(...args);
  }
}
