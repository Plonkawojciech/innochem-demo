import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { themeBootScript } from "../lib/theme-boot";

function boot(
  saved: string | null,
  systemDark = false,
  blockedWrite = false,
  blockedRead = false,
) {
  const root = { dataset: {} as Record<string, string> };
  const attributes: Record<string, string> = {};
  const button = {
    setAttribute: (key: string, value: string) => (attributes[key] = value),
  };
  let inserted = false;
  let persisted = saved;
  type ClickEvent = {
    target: { closest?: (selector: string) => unknown };
    stopPropagation: () => void;
  };
  type Listener = {
    callback: (event: ClickEvent) => void;
    capture: boolean;
  };
  const listeners = new Map<string, Listener[]>();
  const writes: string[] = [];
  let observeInsertion = () => {};
  const document = {
    documentElement: root,
    querySelector: () => (inserted ? button : null),
    querySelectorAll: () => (inserted ? [button] : []),
    addEventListener: (
      name: string,
      callback: Listener["callback"],
      options: boolean | { capture?: boolean } = false,
    ) => {
      const capture =
        typeof options === "boolean" ? options : options.capture === true;
      const registered = listeners.get(name) || [];
      registered.push({ callback, capture });
      listeners.set(name, registered);
    },
  };
  runInNewContext(themeBootScript, {
    document,
    localStorage: {
      getItem: () => {
        if (blockedRead) throw new Error("Storage blocked");
        return persisted;
      },
      setItem: (_key: string, value: string) => {
        if (blockedWrite) throw new Error("Storage blocked");
        writes.push(value);
        persisted = value;
      },
    },
    window: { matchMedia: () => ({ matches: systemDark }) },
    MutationObserver: class {
      constructor(fn: () => void) {
        observeInsertion = fn;
      }
      observe() {}
      disconnect() {}
    },
  });
  return {
    root,
    attributes,
    insert: () => {
      inserted = true;
      observeInsertion();
    },
    // Capture listeners on the document run before a click can bubble back.
    // stopPropagation skips the bubble phase, not other listeners on this node.
    click: (toggle = true, svg = false) => {
      let stopped = false;
      const event: ClickEvent = {
        target: {
          closest: (selector) => {
            assert.equal(selector, "button.theme-toggle");
            return toggle ? button : null;
          },
          ...(svg ? { tagName: "path", ownerSVGElement: {} } : {}),
        },
        stopPropagation: () => {
          stopped = true;
        },
      };
      const registered = listeners.get("click") || [];
      for (const listener of registered.filter((x) => x.capture))
        listener.callback(event);
      if (!stopped)
        for (const listener of registered.filter((x) => !x.capture))
          listener.callback(event);
    },
    blockDuringHydration: () => {
      let hydrating = true;
      document.addEventListener(
        "click",
        (event) => {
          if (hydrating) event.stopPropagation();
        },
        true,
      );
      return () => {
        hydrating = false;
      };
    },
    clickPhases: () => (listeners.get("click") || []).map((x) => x.capture),
    writes,
    saved: () => persisted,
  };
}

test("native theme handles a click before React with the saved DOM theme as its source of truth", () => {
  const page = boot("dark");
  assert.equal(page.root.dataset.theme, "dark");
  page.insert();
  assert.equal(page.attributes["aria-label"], "Włącz tryb jasny");
  page.click();
  assert.equal(page.root.dataset.theme, "light");
  assert.equal(page.saved(), "light");
  assert.equal(page.attributes["aria-label"], "Włącz tryb ciemny");
  page.click(false);
  assert.equal(page.root.dataset.theme, "light");
  page.click();
  assert.equal(page.root.dataset.theme, "dark");
  assert.equal(page.attributes["aria-label"], "Włącz tryb jasny");
});

test("theme boot registers its only click owner in the capture phase", () => {
  const page = boot("light");
  assert.deepEqual(page.clickPhases(), [true]);
});

test("the first theme click survives a hydration capture blocker and the next click toggles once", () => {
  const page = boot("light");
  page.insert();
  const finishHydration = page.blockDuringHydration();
  page.click();
  assert.equal(page.root.dataset.theme, "dark");
  assert.equal(page.saved(), "dark");
  assert.equal(page.attributes["aria-label"], "Włącz tryb jasny");
  assert.deepEqual(page.writes, ["dark"]);
  finishHydration();
  page.click();
  assert.equal(page.root.dataset.theme, "light");
  assert.equal(page.saved(), "light");
  assert.equal(page.attributes["aria-label"], "Włącz tryb ciemny");
  assert.deepEqual(page.writes, ["dark", "light"]);
});

test("clicks on nested SVG paths also survive hydration with unavailable storage", () => {
  const page = boot(null, false, true, true);
  page.insert();
  const finishHydration = page.blockDuringHydration();
  page.click(true, true);
  assert.equal(page.root.dataset.theme, "dark");
  assert.equal(page.attributes["aria-label"], "Włącz tryb jasny");
  assert.equal(page.saved(), null);
  finishHydration();
  page.click(true, true);
  assert.equal(page.root.dataset.theme, "light");
  assert.equal(page.attributes["aria-label"], "Włącz tryb ciemny");
  assert.deepEqual(page.writes, []);
});

test("system preference and unavailable persistent writes retain a working native toggle", () => {
  const page = boot(null, true, true);
  page.insert();
  assert.equal(page.root.dataset.theme, "dark");
  page.click();
  assert.equal(page.root.dataset.theme, "light");
  assert.equal(page.attributes["aria-label"], "Włącz tryb ciemny");
  assert.equal(page.saved(), null);
});

test("blocked storage reads still apply the system preference before React", () => {
  const page = boot(null, true, true, true);
  page.insert();
  assert.equal(page.root.dataset.theme, "dark");
  assert.equal(page.attributes["aria-label"], "Włącz tryb jasny");
  page.click();
  assert.equal(page.root.dataset.theme, "light");
});
