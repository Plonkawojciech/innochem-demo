# Storefront fonts

These are subsets of the same Inter 4.001, Manrope 4.504 and IBM Plex Mono 2.3 previously served by `next/font/google`. The primary files contain Latin, Polish letters, combining accents and common UI punctuation. Complementary faces in `extended.css` retain the other supported characters and load only when needed. Effective coverage matches the previous Google Fonts CSS, recorded in `coverage.json`; other characters retain the system fallback.

Inter retains weights 100–900, Manrope 200–800 (the display uses 600–800), and Mono retains 400/500/700. Inter's optical-size axis is pinned to 14, matching the previous Google Fonts assets. Adjusted Arial fallback metrics and the Mono fallback remain equivalent to the previous build.

`sources.json` records pinned public source URLs, hashes, versions and effective original webfont coverage. The three OFL licenses are included. Modified subsets use new internal family names, respecting the Plex reserved name.

Regeneration: install `fonttools[woff]==4.63.0` and `brotli==1.2.0` in an isolated Python environment, then run `python scripts/subset-fonts.py` from the repository. The script verifies each source hash and emits WOFF2 files and `generated.json`. A verified local source cache can be passed with `--source-dir PATH`. These files are committed; production builds need neither Python nor a Google Fonts request.

`tests/fonts.test.mjs` checks effective original webfont coverage, Polish glyphs, output hashes, variable weights, source pinning and licenses. Performance and visible layout are verified separately in the headless browser audit.
