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
  const listeners = new Map<string, (event: unknown) => void>();
  let observeInsertion = () => {};
  const document = {
    documentElement: root,
    querySelector: () => (inserted ? button : null),
    querySelectorAll: () => (inserted ? [button] : []),
    addEventListener: (name: string, fn: (event: unknown) => void) =>
      listeners.set(name, fn),
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
    click: (toggle = true) =>
      listeners.get("click")!({
        target: { closest: () => (toggle ? button : null) },
      }),
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
