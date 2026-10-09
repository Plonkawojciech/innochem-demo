import assert from "node:assert/strict";

// The parent harness owns browser launch, fresh contexts, navigation and evidence.
// These checks never log in, submit a form or change any server configuration.
export async function checkSeriesContrast(page, popup = false) {
  const selector = popup
    ? "dialog[open] [class*='series']"
    : ".product-page .series-line";
  await page.locator(selector).waitFor({ state: "visible" });
  const result = await page.locator(selector).evaluate((element) => {
    const rgba = (value) => {
      const numbers = value.match(/[\d.]+/g)?.map(Number);
      if (!numbers || numbers.length < 3)
        throw new Error(`Unsupported computed color: ${value}`);
      return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1];
    };
    const blend = (foreground, background) =>
      foreground
        .slice(0, 3)
        .map(
          (channel, index) =>
            channel * foreground[3] + background[index] * (1 - foreground[3]),
        );
    const ancestors = [];
    for (let parent = element; parent; parent = parent.parentElement)
      ancestors.unshift(parent);
    let background = [255, 255, 255];
    for (const ancestor of ancestors)
      background = blend(
        rgba(getComputedStyle(ancestor).backgroundColor),
        background,
      );
    const style = getComputedStyle(element);
    const foreground = blend(rgba(style.color), background);
    const luminance = (rgb) => {
      const linear = rgb.map((component) => {
        const normalized = component / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const values = [luminance(foreground), luminance(background)].sort(
      (a, b) => b - a,
    );
    return {
      text: element.textContent.trim(),
      foreground,
      background,
      fontSize: style.fontSize,
      ratio: (values[0] + 0.05) / (values[1] + 0.05),
      theme: document.documentElement.dataset.theme || "light",
    };
  });
  assert.ok(result.ratio >= 4.5, `${selector}: ${result.ratio}:1`);
  return result;
}

/** Run on a newly navigated product page with menu/dialogs closed. */
export async function checkFooterKeyboardFocus(page, maxTabs = 200) {
  const results = [];
  let targetChecked = false;
  for (let tabs = 1; tabs <= maxTabs; tabs++) {
    await page.keyboard.press("Tab");
    const inFooter = await page.evaluate(() =>
      Boolean(document.activeElement?.closest("footer.site")),
    );
    if (!inFooter) {
      if (results.length) break;
      continue;
    }
    // The independent finding persisted after the complete scroll animation.
    await page.waitForTimeout(1750);
    const result = await page.evaluate(() => {
      const focused = document.activeElement;
      const rect = focused.getBoundingClientRect();
      const points = [
        [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2],
        [rect.left + 2, rect.top + 2],
        [rect.right - 2, rect.top + 2],
        [rect.left + 2, rect.bottom - 2],
        [rect.right - 2, rect.bottom - 2],
      ];
      const bar = document.querySelector(".sticky-buy");
      const barRect = bar?.getBoundingClientRect();
      const barStyle = bar && getComputedStyle(bar);
      const visibleBar =
        bar &&
        !bar.hasAttribute("data-hidden") &&
        barStyle.display !== "none" &&
        barStyle.visibility === "visible" &&
        barRect.top < window.innerHeight;
      return {
        text: focused.textContent.trim(),
        href: focused.getAttribute("href"),
        rect: { top: rect.top, bottom: rect.bottom, height: rect.height },
        height: window.innerHeight,
        barTop: visibleBar ? barRect.top : null,
        hits: points.map(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return Boolean(hit && (hit === focused || focused.contains(hit)));
        }),
        theme: document.documentElement.dataset.theme || "light",
      };
    });
    assert.ok(result.rect.top >= 0, `${result.text}: above viewport`);
    assert.ok(
      result.rect.bottom <= result.height,
      `${result.text}: below viewport`,
    );
    if (result.barTop !== null)
      assert.ok(
        result.rect.bottom <= result.barTop - 5,
        `${result.text}: focus outline obscured by buy bar`,
      );
    assert.deepEqual(result.hits, [true, true, true, true, true], result.text);
    if (result.text === "Zostań dystrybutorem") targetChecked = true;
    results.push({ tabs, ...result });
  }
  assert.ok(targetChecked, "The reported footer link was not reached by Tab");
  return results;
}
