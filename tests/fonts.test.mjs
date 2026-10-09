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
  for (const entry of generated) {
    assert.equal(fs.statSync(path.join(root, entry.file)).size, entry.bytes);
    assert.equal(
      hash(fs.readFileSync(path.join(root, entry.file))),
      entry.sha256,
      entry.file,
    );
  }
  for (const suffix of ["", "-rest"]) {
    const body = font("inter" + suffix + ".woff2");
    const display = font("manrope" + suffix + ".woff2");
    assert.deepEqual(Object.keys(body.variationAxes), ["wght"]);
    assert.equal(body.variationAxes.wght.min, 400);
    assert.equal(body.variationAxes.wght.default, 400);
    assert.equal(body.variationAxes.wght.max, 900);
    assert.deepEqual(
      Object.values(body.namedVariations).map((instance) => instance.wght),
      [400, 500, 600, 700, 800, 900],
    );
    const entry = generated.find(
      (item) => item.file === `inter${suffix}.woff2`,
    );
    assert.deepEqual(entry.axes, {
      wght: { min: 400, default: 400, max: 900 },
    });
    assert.equal(display.variationAxes.wght.min, 200);
    assert.equal(display.variationAxes.wght.max, 800);
    assert.equal(body.variationAxes.opsz, undefined);
  }
});

// Fingerprints were captured from the shipped 100..900 baseline before the
// restriction. These cover every glyph, including unencoded feature glyphs,
// and shaping of every printable supported codepoint at the unchanged default.
// Full 400..900 geometry/HarfBuzz and native render proofs are separate gates;
// Next's bundled fontkit cannot instantiate WOFF2 variants via getVariation.
const interBaseline = {
  "inter.woff2": {
    source: "eee40ce2e753edcbd15b2ee6d1db28c7f9389551566d1a2443c1ef08635cd22f",
    candidate:
      "8f0e0a23ff76717f9f2b60e14944ebb70b4c45457cca0aeb8745cfd75049a2ce",
    glyphs: 941,
    features:
      "aalt calt case ccmp cpsp cv01 cv02 cv03 cv04 cv05 cv06 cv07 cv08 cv09 cv10 cv11 cv12 cv13 dlig dnom frac kern mark mkmk numr ordn pnum salt sinf ss01 ss02 ss03 ss04 ss05 ss06 ss07 ss08 subs sups tnum zero",
    outlines:
      "eeac98f67dd54188fc4423a97ecddfa0cc115d5e3b95d07347c9c25989f16c1f",
    shaping: [
      "7264593930c01d0f1c105ac2557de2d313aa66e9a96d55bfd3b509f410c163c6",
      "8bdd14a0f03a1fd10d32696ffcd04330c8813faa17b878cb6014b1b7c1e52970",
    ],
  },
  "inter-rest.woff2": {
    source: "ce491fbd96b0bc2605d37abf45b1df3ed5083440b074c8946a71faa86da85051",
    candidate:
      "4fa031ef41f10de9ee86fa0aa0a5e2099ea9f8d82659653ba6f4ea2f70bc0601",
    glyphs: 1833,
    features:
      "aalt ccmp cpsp cv05 cv06 cv08 cv10 cv11 cv12 cv13 cv14 dlig kern salt ss02 ss03 ss04 ss07 ss08",
    outlines:
      "d0e6402afdfafd356d5092bce9bcfc420e1c81a5a391d42170fc7aaff8539dfc",
    shaping: [
      "c6762ac76a4ad980412581f74cda105a14dbdecf1411f1e1ab5ecb5609bb61d5",
      "c6762ac76a4ad980412581f74cda105a14dbdecf1411f1e1ab5ecb5609bb61d5",
    ],
  },
};

test("restricted Inter retains baseline default outlines, metrics and features", () => {
  const digest = (value) => hash(JSON.stringify(value));
  for (const [filename, baseline] of Object.entries(interBaseline)) {
    const body = font(filename);
    const entry = generated.find((item) => item.file === filename);
    assert.equal(entry.baselineSha256, baseline.source, filename);
    assert.equal(entry.sha256, baseline.candidate, filename);
    assert.equal(body.numGlyphs, baseline.glyphs, filename);
    assert.deepEqual(
      body.availableFeatures.sort(),
      baseline.features.split(" "),
      filename,
    );
    const metrics = [
      "unitsPerEm",
      "ascent",
      "descent",
      "lineGap",
      "capHeight",
      "xHeight",
      "underlinePosition",
      "underlineThickness",
    ].map((field) => body[field]);
    assert.deepEqual(metrics, [2048, 1984, -494, 0, 1490, 1118, -348, 140]);
    const glyphs = Array.from({ length: body.numGlyphs }, (_, id) => {
      const glyph = body.getGlyph(id);
      return [glyph.id, glyph.advanceWidth, glyph.path.commands];
    });
    assert.equal(digest(glyphs), baseline.outlines, filename);
    // Outline inspection populates fontkit's glyph cache and affects its mark
    // positions even for the baseline. Shape using a separate fresh decoder.
    const shapingFont = font(filename);
    const text = shapingFont.characterSet
      .filter(
        (c) => c >= 32 && c !== 0xffff && shapingFont.hasGlyphForCodePoint(c),
      )
      .sort((a, b) => a - b)
      .map((c) => String.fromCodePoint(c))
      .join("");
    for (const [index, features] of [[], ["tnum"]].entries()) {
      const run = shapingFont.layout(text, features);
      assert.equal(
        digest({
          glyphs: run.glyphs.map((glyph) => glyph.id),
          positions: run.positions.map((p) => [
            p.xAdvance,
            p.yAdvance,
            p.xOffset,
            p.yOffset,
          ]),
        }),
        baseline.shaping[index],
        `${filename} / features ${features}`,
      );
    }
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
  assert.match(
    layout,
    /src:\s*"\.\/fonts\/inter\.woff2",\s*weight:\s*"400 900"/,
  );
  assert.match(
    css,
    /font-family:\s*"InnochemBodyExtended";[^}]*font-weight:\s*400 900;/,
  );
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
