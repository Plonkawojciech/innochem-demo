"""Build complementary font subsets without changing outlines or weight coverage.

Requires fonttools[woff]==4.63.0 and brotli==1.2.0; no build-time dependency.
Source files and licenses are fetched only from the pinned public manifest.
"""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "app/fonts"
RANGES = [(0, 0xFF), (0x104, 0x107), (0x118, 0x119), (0x131, 0x131),
          (0x141, 0x144), (0x152, 0x153), (0x15A, 0x15B), (0x179, 0x17C),
          (0x2BB, 0x2BC), (0x2C6, 0x2C6), (0x2DA, 0x2DA), (0x2DC, 0x2DC),
          (0x300, 0x36F), (0x2000, 0x206F), (0x2074, 0x2074), (0x20AC, 0x20AC),
          (0x2122, 0x2122), (0x2190, 0x2193), (0x2212, 0x2212), (0x2215, 0x2215),
          (0x25BE, 0x25BE), (0x2713, 0x2713), (0xFEFF, 0xFEFF), (0xFFFD, 0xFFFD)]
PRIMARY = {c for lo, hi in RANGES for c in range(lo, hi + 1)}


def build(source, output, characters, family):
    font = TTFont(source, recalcTimestamp=False)
    # Resolve variation glyphs before subset changes the lazy table's glyph order.
    if "gvar" in font:
        font["gvar"].variations = dict(font["gvar"].variations)
    # next/font/google serves Inter at opsz=14, with only the weight axis.
    if "fvar" in font and any(a.axisTag == "opsz" for a in font["fvar"].axes):
        font = instantiateVariableFont(font, {"opsz": 14}, inplace=True)
        # Instancing removes zero-delta glyph entries; the subsetter expects them.
        if "gvar" in font:
            for glyph in font.getGlyphOrder():
                font["gvar"].variations.setdefault(glyph, [])
    options = subset.Options()
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.name_legacy = True
    options.layout_features = ["*"]
    tool = subset.Subsetter(options=options)
    tool.populate(unicodes=characters)
    tool.subset(font)
    # Modified subsets use new names, respecting the Plex reserved font name.
    for record in font["name"].names:
        if record.nameID in (1, 3, 4, 6, 16, 18, 25):
            record.string = family.encode(record.getEncoding())
    font.flavor = "woff2"
    font.save(output)
    return {"file": output.name, "bytes": output.stat().st_size,
            "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            "characters": len(font.getBestCmap())}


def unicode_range(points):
    ranges = []
    for point in sorted(points):
        if ranges and point == ranges[-1][1] + 1:
            ranges[-1] = (ranges[-1][0], point)
        else:
            ranges.append((point, point))
    return ",".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in ranges)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, help="Optional verified offline source cache")
    args = parser.parse_args()
    manifest = json.loads((DEST / "sources.json").read_text())
    coverage = json.loads((DEST / "coverage.json").read_text())["families"]
    reports = []
    faces = []
    with tempfile.TemporaryDirectory(prefix="innochem-fonts-") as tmp:
        for item in manifest:
            data = (args.source_dir / item["font"]).read_bytes() if args.source_dir else urllib.request.urlopen(item["source"]).read()
            if hashlib.sha256(data).hexdigest() != item["sha256"]:
                raise ValueError("Font source changed: " + item["source"])
            source = Path(tmp) / item["font"]
            source.write_bytes(data)
            characters = set(coverage[item["coverageFamily"]])
            if not characters <= set(TTFont(source).getBestCmap()):
                raise ValueError("Source no longer covers the original webfont characters")
            reports.append(build(source, DEST / (item["output"] + ".woff2"),
                                 characters & PRIMARY, item["family"]))
            reports.append(build(source, DEST / (item["output"] + "-rest.woff2"),
                                 characters - PRIMARY, item["family"] + "Extended"))
            family = "InnochemMonoExtended" if item["output"].startswith("mono-") else item["family"] + "Extended"
            weight = item["output"].removeprefix("mono-") if item["output"].startswith("mono-") else "100 900" if item["output"] == "inter" else "600 800"
            faces.append(f'@font-face {{\n  font-family: "{family}";\n  src: url("./{item["output"]}-rest.woff2") format("woff2");\n  font-weight: {weight};\n  font-style: normal;\n  font-display: swap;\n  unicode-range: {unicode_range(characters - PRIMARY)};\n}}\n')
    # Keep the known Google-adjusted fallback metrics verbatim.
    css = (DEST / "extended.css").read_text()
    fallback = css[css.index("/* Same adjusted Arial metrics"):]
    (DEST / "extended.css").write_text("/* Generated complementary glyph coverage. */\n" + "\n".join(faces) + "\n" + fallback)
    (DEST / "generated.json").write_text(json.dumps(reports, indent=2) + "\n")
    print(json.dumps(reports, indent=2))


if __name__ == "__main__":
    main()
