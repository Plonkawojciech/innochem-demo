import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const globalCss = fs.readFileSync("app/globals.css", "utf8");
const popupCss = fs.readFileSync(
  "components/AddToCartPopup.module.css",
  "utf8",
);
const declarations = (body) =>
  Object.fromEntries(
    [...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  );
const block = (css, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, selector);
  return declarations(match[1]);
};
const vars = (theme) => {
  const base = {};
  const dark = {};
  for (const match of globalCss.matchAll(
    /:root(\[data-theme="dark"\])?\s*\{([^}]+)\}/g,
  ))
    Object.assign(match[1] ? dark : base, declarations(match[2]));
  return theme === "dark" ? { ...base, ...dark } : base;
};
const resolve = (value, tokens) =>
  value.startsWith("var(") ? tokens[value.slice(4, -1)] : value;
const luminance = (color) => {
  assert.match(color, /^#[\da-f]{6}$/i);
  const rgb = color
    .slice(1)
    .match(/../g)
    .map((component) => parseInt(component, 16) / 255)
    .map((component) =>
      component <= 0.04045
        ? component / 12.92
        : ((component + 0.055) / 1.055) ** 2.4,
    );
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
};

for (const theme of ["light", "dark"]) {
  for (const [name, css, selector, background] of [
    ["product", globalCss, ".series-line", "--bg"],
    ["popup", popupCss, ".series", "--panel"],
  ])
    test(`small ${name} series text passes AA in ${theme} theme`, () => {
      const tokens = vars(theme);
      const rule = block(css, selector);
      assert.ok(parseFloat(rule["font-size"]) < 18, selector);
      const ratio = contrast(resolve(rule.color, tokens), tokens[background]);
      assert.ok(ratio >= 4.5, `${selector} ${theme}: ${ratio.toFixed(3)}:1`);
    });
  test(`catalogue series contrast remains AA in ${theme} theme`, () => {
    const tokens = vars(theme);
    const rule = block(globalCss, ".card .series");
    assert.ok(contrast(resolve(rule.color, tokens), tokens["--panel"]) >= 4.5);
  });
}
