import test from "node:test";
import assert from "node:assert/strict";
import { stickyFocusScrollDelta } from "../lib/sticky-buy-focus";

const viewport = { top: 0, bottom: 900, left: 0, right: 390 };
const bar = { top: 824, bottom: 900, left: 0, right: 390 };
const footer = { top: 870.48, bottom: 899.92, left: 20, right: 205 };
const header = { top: 0, bottom: 73, left: 0, right: 390 };

test("reverse Tab exposes the complete email link below the sticky header", () => {
  const email = { top: 69.84375, bottom: 99.28125, left: 16, right: 202 };
  const delta = stickyFocusScrollDelta(email, bar, viewport, 8, header);
  assert.ok(delta < 0);
  assert.equal(email.top - delta, header.bottom + 8);
  assert.ok(email.bottom - delta < bar.top - 8);
});

test("reverse Tab keeps the full footer links between both bars in landscape", () => {
  const landscape = { top: 0, bottom: 320, left: 0, right: 568 };
  const landscapeHeader = { ...header, right: 568 };
  const landscapeBar = { top: 244, bottom: 320, left: 0, right: 568 };
  for (const top of [46.3, 16.86, 0.42, 43.31, 13.88, 0.44, 43.33]) {
    const link = { top, bottom: top + 29.44, left: 16, right: 202 };
    const delta = stickyFocusScrollDelta(
      link,
      landscapeBar,
      landscape,
      8,
      landscapeHeader,
    );
    assert.ok(delta < 0);
    assert.ok(link.top - delta >= landscapeHeader.bottom + 8);
    assert.ok(link.bottom - delta <= landscapeBar.top - 8);
  }
});

test("header resizing and a clear reverse focus use current geometry", () => {
  const resized = { ...header, bottom: 96 };
  const link = { top: 90, bottom: 120, left: 16, right: 202 };
  const delta = stickyFocusScrollDelta(link, bar, viewport, 8, resized);
  assert.equal(link.top - delta, resized.bottom + 8);
  assert.equal(
    stickyFocusScrollDelta(
      { ...link, top: 110, bottom: 140 },
      bar,
      viewport,
      8,
      resized,
    ),
    0,
  );
});

test("a control too tall for the viewport cannot trigger alternating corrections", () => {
  const tiny = { top: 0, bottom: 160, left: 0, right: 390 };
  const tinyBar = { ...bar, top: 84, bottom: 160 };
  const link = { top: 40, bottom: 69, left: 16, right: 202 };
  assert.equal(stickyFocusScrollDelta(link, tinyBar, tiny, 8, header), 0);
});

test("the complete obscured footer link clears the actual buy bar and outline", () => {
  const delta = stickyFocusScrollDelta(footer, bar, viewport);
  assert.ok(delta > 0);
  assert.ok(footer.bottom - delta <= bar.top - 8);
  assert.ok(footer.top - delta >= viewport.top);
});

test("partial occlusion is corrected without moving an already clear focus", () => {
  assert.equal(
    stickyFocusScrollDelta({ ...footer, top: 790, bottom: 820 }, bar, viewport),
    4,
  );
  assert.equal(
    stickyFocusScrollDelta({ ...footer, top: 775, bottom: 810 }, bar, viewport),
    0,
  );
});

test("wrapped notices and safe-area growth use the new bar geometry", () => {
  const tall = { ...bar, top: 720 };
  const delta = stickyFocusScrollDelta(footer, tall, viewport);
  assert.ok(footer.bottom - delta <= tall.top - 8);
  assert.equal(delta - stickyFocusScrollDelta(footer, bar, viewport), 104);
});

test("a resized visual viewport keeps the whole focused control above its bar", () => {
  const visual = { top: 90, bottom: 590, left: 0, right: 360 };
  const keyboardBar = { top: 508, bottom: 590, left: 0, right: 360 };
  const link = { top: 560, bottom: 584, left: 16, right: 200 };
  const delta = stickyFocusScrollDelta(link, keyboardBar, visual);
  assert.equal(link.bottom - delta, keyboardBar.top - 8);
  assert.ok(link.top - delta >= visual.top);
});

test("hidden, desktop and horizontally separate bars do not hijack scrolling", () => {
  assert.equal(
    stickyFocusScrollDelta(footer, { ...bar, top: 900, bottom: 976 }, viewport),
    0,
  );
  assert.equal(
    stickyFocusScrollDelta(footer, { ...bar, top: 0, bottom: 0 }, viewport),
    0,
  );
  assert.equal(
    stickyFocusScrollDelta({ ...footer, left: 400, right: 500 }, bar, viewport),
    0,
  );
});

test("non-finite rectangles cannot cause an invalid browser scroll", () => {
  assert.equal(
    stickyFocusScrollDelta({ ...footer, bottom: Number.NaN }, bar, viewport),
    0,
  );
  assert.equal(
    stickyFocusScrollDelta(footer, { ...bar, top: Infinity }, viewport),
    0,
  );
});
