import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const loaded = require("next/dist/compiled/@next/font/dist/fontkit").default;
const fontFromBuffer = loaded.default || loaded;
const root = path.resolve("app/fonts");
const sources = JSON.parse(fs.readFileSync(path.join(root, "sources.json")));
const coverage = JSON.parse(
  fs.readFileSync(path.join(root, "coverage.json")),
).families;
const generated = JSON.parse(
  fs.readFileSync(path.join(root, "generated.json")),
);
const hash = (data) => createHash("sha256").update(data).digest("hex");
const font = (name) => fontFromBuffer(fs.readFileSync(path.join(root, name)));

test("subsets retain every original supported codepoint and Polish glyphs", () => {
  for (const source of sources) {
    const primary = font(source.output + ".woff2");
    const rest = font(source.output + "-rest.woff2");
    const covered = [
      // Format-4's U+FFFF sentinel can appear in characterSet with glyph id 0.
      ...new Set([
        ...primary.characterSet.filter((c) => primary.hasGlyphForCodePoint(c)),
        ...rest.characterSet.filter((c) => rest.hasGlyphForCodePoint(c)),
      ]),
    ].sort((a, b) => a - b);
    assert.equal(covered.length, source.codepointCount, source.output);
    assert.equal(
      hash(JSON.stringify(covered)),
      source.codepointsSha256,
      source.output,
    );
    for (const char of "ĄĆĘŁŃÓŚŹŻąćęłńóśźż")
      assert.ok(
        primary.hasGlyphForCodePoint(char.codePointAt(0)),
        source.output + ": " + char,
      );
  }
});

test("font files match the generated manifest and retain variable weights", () => {
  for (const entry of generated)
    assert.equal(
      hash(fs.readFileSync(path.join(root, entry.file))),
      entry.sha256,
      entry.file,
    );
  for (const suffix of ["", "-rest"]) {
    const body = font("inter" + suffix + ".woff2");
    const display = font("manrope" + suffix + ".woff2");
    assert.equal(body.variationAxes.wght.min, 100);
    assert.equal(body.variationAxes.wght.max, 900);
    assert.equal(display.variationAxes.wght.min, 200);
    assert.equal(display.variationAxes.wght.max, 800);
    assert.equal(body.variationAxes.opsz, undefined);
  }
});

test("font sources are pinned public revisions and licenses are shipped", () => {
  for (const source of sources)
    assert.match(
      source.source,
      /^https:\/\/raw\.githubusercontent\.com\/google\/fonts\/[a-f0-9]{40}\/ofl\//,
    );
  for (const family of ["inter", "manrope", "ibmplexmono"])
    assert.match(
      fs.readFileSync(path.join(root, family + "-OFL.txt"), "utf8"),
      /SIL OPEN FONT LICENSE/,
    );
});

test("tabular numerals still shape as equal-width digits in cart prices", () => {
  const body = font("inter.woff2");
  assert.ok(body.availableFeatures.includes("tnum"));
  const advances = body
    .layout("0123456789", ["tnum"])
    .positions.map((p) => p.xAdvance);
  assert.equal(new Set(advances).size, 1);
});

test("declared font ranges match the subsets and original web coverage", () => {
  const ranges = (text) => {
    const points = new Set();
    for (const m of text.matchAll(/U\+([0-9A-F]+)(?:-([0-9A-F]+))?/gi))
      for (let n = parseInt(m[1], 16); n <= parseInt(m[2] || m[1], 16); n++)
        points.add(n);
    return points;
  };
  const layout = fs.readFileSync("app/layout.tsx", "utf8");
  const declared = [...layout.matchAll(/value:\s*"(U\+[^"]+)"/g)].map((m) =>
    ranges(m[1]),
  );
  assert.equal(declared.length, 3);
  for (const range of declared) assert.deepEqual(range, declared[0]);
  const css = fs.readFileSync(path.join(root, "extended.css"), "utf8");
  const faces = [
    ...css.matchAll(/@font-face\s*\{[^}]*unicode-range:([^;}]+)[^}]*\}/g),
  ];
  assert.equal(faces.length, sources.length);
  for (const [index, source] of sources.entries()) {
    const expected = new Set(coverage[source.coverageFamily]);
    const primary = font(source.output + ".woff2");
    const primaryActual = new Set(
      primary.characterSet.filter((c) => primary.hasGlyphForCodePoint(c)),
    );
    assert.deepEqual(
      primaryActual,
      new Set([...expected].filter((c) => declared[0].has(c))),
      source.output,
    );
    const extended = ranges(faces[index][1]);
    assert.deepEqual(
      extended,
      new Set([...expected].filter((c) => !declared[0].has(c))),
      source.output,
    );
    assert.ok(
      !extended.has(0x25be),
      "The existing caret must keep its system fallback",
    );
  }
});
