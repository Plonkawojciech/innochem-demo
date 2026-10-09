import assert from "node:assert/strict";

/** Run with the caller's owned Playwright page at mobile and tablet widths. */
export async function assertMobileMenuFocus(page, baseUrl) {
  await page.goto(new URL("/katalog", baseUrl).href, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => {
    const button = document.querySelector("button.burger");
    return button && !button.disabled;
  });
  const burger = page.locator("button.burger");
  const search = page.locator('input[name="q"]');
  const expanded = () => burger.getAttribute("aria-expanded");
  const openByKeyboard = async () => {
    await burger.focus();
    await page.keyboard.press("Enter");
    assert.equal(await expanded(), "true");
    await page.locator("#mobile-menu").waitFor({ state: "visible" });
  };
  const closed = async () => {
    await page.waitForFunction(
      () =>
        !document.querySelector("#mobile-menu") &&
        document
          .querySelector("button.burger")
          ?.getAttribute("aria-expanded") === "false",
    );
  };

  await openByKeyboard();
  let menuLinksReached = 0;
  let reachedSearch = false;
  let tabs = 0;
  for (; tabs < 100; tabs++) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        inHeader: !!document.querySelector("header.site")?.contains(active),
        inMenu: !!document.querySelector("#mobile-menu")?.contains(active),
        search: active?.matches('input[name="q"]') ?? false,
      };
    });
    if (focus.inMenu) menuLinksReached++;
    if (focus.inHeader) assert.equal(await expanded(), "true");
    else await closed();
    if (focus.search) {
      reachedSearch = true;
      break;
    }
  }
  assert.ok(menuLinksReached > 0, "Tab must actually traverse menu links");
  assert.ok(reachedSearch, "Native Tab must reach the catalog search");
  await page.waitForFunction(() => {
    const input = document.querySelector('input[name="q"]');
    if (!input || input !== document.activeElement) return false;
    const rect = input.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return (
      x >= 0 &&
      y >= 0 &&
      x < innerWidth &&
      y < innerHeight &&
      input.contains(document.elementFromPoint(x, y))
    );
  });

  await openByKeyboard();
  await page.keyboard.press("Escape");
  await closed();
  assert.equal(
    await burger.evaluate((button) => button === document.activeElement),
    true,
  );
  await burger.click();
  assert.equal(await expanded(), "true");
  await search.focus();
  await closed();
  assert.equal(
    await search.evaluate((input) => input === document.activeElement),
    true,
  );
  await burger.click();
  assert.equal(await expanded(), "true");
  await burger.click();
  await closed();
  return { tabs: tabs + 1, menuLinksReached, searchUncovered: true };
}
