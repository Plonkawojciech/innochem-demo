"""Build complementary font subsets while preserving the used outlines.

Requires fonttools[woff]==4.63.0 and brotli==1.2.0; no build-time dependency.
Source files and licenses are fetched only from the pinned public manifest.
Inter follows opsz=14 -> original subset -> canonical WOFF2 -> wght=400..900.
The baseline and final hashes bind regeneration to the exhaustively compared
artifacts; do not refresh them without repeating geometry and rendering proofs.
"""
import argparse
from copy import deepcopy
import hashlib
import io
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
INTER_ARTIFACTS = {
    "InnochemBody": {
        "baseline": "eee40ce2e753edcbd15b2ee6d1db28c7f9389551566d1a2443c1ef08635cd22f",
        "restricted": "8f0e0a23ff76717f9f2b60e14944ebb70b4c45457cca0aeb8745cfd75049a2ce",
    },
    "InnochemBodyExtended": {
        "baseline": "ce491fbd96b0bc2605d37abf45b1df3ed5083440b074c8946a71faa86da85051",
        "restricted": "4fa031ef41f10de9ee86fa0aa0a5e2099ea9f8d82659653ba6f4ea2f70bc0601",
    },
}


def restrict_inter_weight(font, family):
    # Canonicalize through the original WOFF2 representation. Its IUP omissions
    # are part of the proven source, not interchangeable rounded delta arrays.
    canonical = io.BytesIO()
    font.save(canonical)
    baseline = canonical.getvalue()
    binding = INTER_ARTIFACTS[family]
    if hashlib.sha256(baseline).hexdigest() != binding["baseline"]:
        raise ValueError("Inter baseline regeneration changed: " + family)
    font = TTFont(io.BytesIO(baseline), recalcTimestamp=False)
    axes = font["fvar"].axes
    if len(axes) != 1 or (axes[0].axisTag, axes[0].minValue,
                          axes[0].defaultValue, axes[0].maxValue) != ("wght", 100, 400, 900):
        raise ValueError("Unexpected Inter weight axis")
    names = deepcopy(font["name"].names)
    positive_gvar = {
        glyph: deepcopy([variation for variation in font["gvar"].variations.get(glyph, [])
                         if variation.axes["wght"][1] >= 0])
        for glyph in font.getGlyphOrder()
    }
    default_outlines = font["glyf"].compile(font)
    default_advances = font["hmtx"].compile(font)
    font = instantiateVariableFont(font, {"wght": (400, 400, 900)}, inplace=True,
                                   optimize=False, updateFontNames=False)
    if (font["glyf"].compile(font) != default_outlines or
            font["hmtx"].compile(font) != default_advances):
        raise ValueError("Inter default outlines or advances changed")
    # Instancing rewrites IUP deltas even with optimize=False. The positive axis
    # normalization/support is unchanged, so retain the exact original tuples.
    # Other variable tables still receive FontTools' axis restriction.
    font["gvar"].variations = positive_gvar
    # Preserve every original name/license/feature-description record, including
    # orphaned names of the removed 100/200/300 named fvar instances.
    font["name"].names = names
    return font


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
    if family in INTER_ARTIFACTS:
        font = restrict_inter_weight(font, family)
    encoded = io.BytesIO()
    font.save(encoded)
    data = encoded.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    if family in INTER_ARTIFACTS and digest != INTER_ARTIFACTS[family]["restricted"]:
        raise ValueError("Inter restricted artifact changed: " + family)
    output.write_bytes(data)
    report = {"file": output.name, "bytes": len(data), "sha256": digest,
              "characters": len(font.getBestCmap())}
    if family in INTER_ARTIFACTS:
        report["axes"] = {"wght": {"min": 400, "default": 400, "max": 900}}
        report["baselineSha256"] = INTER_ARTIFACTS[family]["baseline"]
    return report


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
            weight = item["output"].removeprefix("mono-") if item["output"].startswith("mono-") else "400 900" if item["output"] == "inter" else "600 800"
            faces.append(f'@font-face {{\n  font-family: "{family}";\n  src: url("./{item["output"]}-rest.woff2") format("woff2");\n  font-weight: {weight};\n  font-style: normal;\n  font-display: swap;\n  unicode-range: {unicode_range(characters - PRIMARY)};\n}}\n')
    # Keep the known Google-adjusted fallback metrics verbatim.
    css = (DEST / "extended.css").read_text()
    fallback = css[css.index("/* Same adjusted Arial metrics"):]
    (DEST / "extended.css").write_text("/* Generated complementary glyph coverage. */\n" + "\n".join(faces) + "\n" + fallback)
    (DEST / "generated.json").write_text(json.dumps(reports, indent=2) + "\n")
    print(json.dumps(reports, indent=2))


if __name__ == "__main__":
    main()
