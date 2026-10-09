import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";

const [base, output, countText] = process.argv.slice(2);
const count = Number(countText);
if (
  !["https://sklep-innochem.programo.pl", "http://127.0.0.1:3061"].includes(
    base,
  ) ||
  !output ||
  !path.isAbsolute(output) ||
  !Number.isInteger(count) ||
  count < 1 ||
  count > 6
)
  throw Error(
    "Expected allowed origin, new absolute output directory and 1–6 samples",
  );
const tooling = process.env.LIGHTHOUSE_MODULES;
if (!tooling || !path.isAbsolute(tooling))
  throw Error(
    "LIGHTHOUSE_MODULES must point to an existing dependency directory",
  );
const linux = process.platform === "linux";
const expectedBrowserVersion =
  process.env.INNOCHEM_EXPECTED_BROWSER_VERSION || (!linux && "154.0.8037.98");
if (
  !expectedBrowserVersion ||
  !/^\d+\.\d+\.\d+\.\d+$/.test(expectedBrowserVersion)
)
  throw Error(
    "Pin the installed Linux browser version before declaring its series",
  );
const chromePath = linux
  ? "/usr/bin/chromium"
  : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// Linux uses a dedicated container without secrets, ports or collector mounts. Its
// sandbox policy stays identical across that separate VM series.
const chromeFlags = linux
  ? ["--headless=new", "--no-sandbox"]
  : ["--headless=new"];
const sourceSHA =
  process.env.INNOCHEM_SOURCE_SHA ||
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(sourceSHA)) throw Error("Missing exact source SHA");
const profile = {
  formFactor: "mobile",
  screenEmulation: {
    mobile: true,
    width: 412,
    height: 823,
    deviceScaleFactor: 1.75,
    disabled: false,
  },
  throttlingMethod: "simulate",
  throttling: {
    rttMs: 150,
    throughputKbps: 1638.4,
    requestLatencyMs: 562.5,
    downloadThroughputKbps: 1474.56,
    uploadThroughputKbps: 675,
    cpuSlowdownMultiplier: 4,
  },
};
const capacity = () => ({
  at: new Date().toISOString(),
  load: os.loadavg(),
  cpuCount: os.cpus().length,
  freeMemoryBytes: os.freemem(),
});
const versions = {};
for (const [name, expected] of Object.entries({
  lighthouse: "13.5.0",
  "chrome-launcher": "1.2.2",
})) {
  const installed = JSON.parse(
    await fs.readFile(path.join(tooling, name, "package.json"), "utf8"),
  ).version;
  if (installed !== expected)
    throw Error(`Unexpected ${name} version ${installed}`);
  versions[name] = installed;
}
await fs.mkdir(output); // Never replace a previous series, including failed runs.
const runnerBytes = await fs.readFile(new URL(import.meta.url));
await fs.writeFile(path.join(output, "runner.mjs.txt"), runnerBytes);
const report = {
  at: new Date().toISOString(),
  base,
  sourceSHA,
  trackedSourceModified: process.env.INNOCHEM_SOURCE_SHA
    ? null
    : !!execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
        encoding: "utf8",
      }).trim(),
  localBuildId: base.startsWith("http:")
    ? (await fs.readFile(".next/BUILD_ID", "utf8")).trim()
    : null,
  profile,
  executionHost: {
    platform: process.platform,
    arch: process.arch,
    expectedBrowserVersion,
    chromePath,
    additionalChromeFlags: chromeFlags,
    environmentKeys: Object.keys(process.env).sort(),
    containerScope: linux
      ? "Dedicated QA container; no collector environment, profile, mounts or ports; image /profile replaced with private tmpfs"
      : null,
  },
  versions: { ...versions, node: process.version },
  plannedSamples: count,
  runnerSHA256: crypto.createHash("sha256").update(runnerBytes).digest("hex"),
  targetMs: 2500,
  scope:
    "Homepage public GET; own isolated Chrome process/profile per cold sample",
  observedLcpScope:
    "Unthrottled input trace; modeled Lighthouse LCP is the target",
  runs: [],
};
if (process.env.INNOCHEM_RUNTIME_PROOF) {
  const bytes = await fs.readFile(process.env.INNOCHEM_RUNTIME_PROOF);
  const runtime = JSON.parse(bytes);
  if (!runtime.image?.endsWith(`:${sourceSHA}`))
    throw Error("Runtime image does not match the declared source SHA");
  report.runtimeProofSHA256 = crypto
    .createHash("sha256")
    .update(bytes)
    .digest("hex");
  await fs.writeFile(path.join(output, "runtime-proof.json"), bytes);
}
const { default: lighthouse } = await import(
  path.join(tooling, "lighthouse/core/index.js")
);
const launcher = await import(
  path.join(tooling, "chrome-launcher/dist/index.js")
);
let activeChrome;
async function closeOwnedBrowser() {
  const child = activeChrome?.chromeProcess;
  if (!child) return false;
  if (child.exitCode === null && child.signalCode === null) {
    const closed = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(Error("Owned Chrome did not emit close within 10 seconds")),
        10000,
      );
      child.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    activeChrome.kill();
    await closed;
  } else {
    activeChrome.kill();
  }
  activeChrome = null;
  return true;
}
async function save() {
  await fs.writeFile(
    path.join(output, "measurements.json"),
    JSON.stringify(report, null, 2),
  );
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    report.interrupted = { signal, at: new Date().toISOString() };
    if (activeChrome) await closeOwnedBrowser();
    await save();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
await save();
for (let run = 1; run <= count; run++) {
  const row = {
    run,
    capacityBefore: capacity(),
    valid: false,
    browserClosed: false,
  };
  report.runs.push(row);
  const userDataDir = path.join(output, `profile-${run}`);
  try {
    await fs.mkdir(userDataDir); // chrome-launcher requires an existing supplied directory.
    activeChrome = new launcher.Launcher({
      chromePath,
      chromeFlags,
      userDataDir,
      maxConnectionRetries: 240,
      connectionPollInterval: 500,
    });
    await activeChrome.launch();
    row.browserPID = activeChrome.pid;
    row.browserFlags = activeChrome.flags;
    if (!row.browserPID) throw Error("Missing owned browser PID");
    const version = await (
      await fetch(`http://127.0.0.1:${activeChrome.port}/json/version`)
    ).json();
    row.browserVersion = version.Browser;
    if (!row.browserVersion.endsWith(`/${expectedBrowserVersion}`))
      throw Error(
        `Unexpected browser ${row.browserVersion}; do not combine versions`,
      );
    const {
      lhr,
      artifacts,
      report: html,
    } = await lighthouse(`${base}/`, {
      port: activeChrome.port,
      logLevel: "error",
      output: "html",
      onlyCategories: ["performance"],
      ...profile,
    });
    await fs.writeFile(
      path.join(output, `home-${run}.json`),
      JSON.stringify(lhr),
    );
    await fs.writeFile(path.join(output, `home-${run}.html`), html);
    for (const key of ["Trace", "DevtoolsLog"])
      if (artifacts[key])
        await fs.writeFile(
          path.join(output, `home-${run}-${key}.json.gz`),
          gzipSync(JSON.stringify(artifacts[key])),
        );
    const audits = lhr.audits;
    Object.assign(row, {
      lcp: audits["largest-contentful-paint"].numericValue,
      observedTraceLcp:
        audits.metrics.details.items[0].observedLargestContentfulPaint,
      fcp: audits["first-contentful-paint"].numericValue,
      tbt: audits["total-blocking-time"].numericValue,
      cls: audits["cumulative-layout-shift"].numericValue,
      score: lhr.categories.performance.score,
      runtimeError: lhr.runtimeError || null,
      failures: audits["network-requests"].details.items.filter(
        (r) => r.statusCode >= 400,
      ),
      nonReadRequests: (artifacts.DevtoolsLog || [])
        .filter((event) => event.method === "Network.requestWillBeSent")
        .map((event) => event.params.request)
        .filter(
          (request) => !["GET", "HEAD", "OPTIONS"].includes(request.method),
        )
        .map((request) => ({ method: request.method, url: request.url })),
    });
    row.valid =
      !row.runtimeError &&
      !row.failures.length &&
      !row.nonReadRequests.length &&
      Number.isFinite(row.lcp) &&
      !!artifacts.Trace &&
      !!artifacts.DevtoolsLog;
    row.targetPassed = row.valid && row.lcp < 2500;
  } catch (error) {
    row.failure = String(error);
  } finally {
    if (activeChrome) {
      try {
        row.browserClosed = await closeOwnedBrowser();
        if (row.browserClosed)
          await fs.rm(userDataDir, { recursive: true, force: true });
      } catch (error) {
        row.cleanupFailure = String(error);
      }
    }
    row.capacityAfter = capacity();
    await save();
    console.log(JSON.stringify(row));
  }
  if (!row.browserClosed)
    throw Error("Owned browser did not close; stop before next sample");
}
report.finishedAt = new Date().toISOString();
report.worstLcp = Math.max(...report.runs.map((r) => r.lcp ?? Infinity));
report.targetAllPassed =
  report.runs.length === count &&
  report.runs.every((r) => r.valid && r.targetPassed && r.browserClosed);
await save();
const hashes = [];
for (const name of (await fs.readdir(output)).sort()) {
  const bytes = await fs.readFile(path.join(output, name));
  hashes.push({
    name,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  });
}
await fs.writeFile(
  path.join(output, "hashes.json"),
  JSON.stringify(hashes, null, 2),
);
if (report.runs.some((r) => !r.valid)) process.exitCode = 2;
