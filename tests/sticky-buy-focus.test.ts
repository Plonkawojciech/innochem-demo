import test from "node:test";
import assert from "node:assert/strict";
import { stickyFocusScrollDelta } from "../lib/sticky-buy-focus";

const viewport = { top: 0, bottom: 900, left: 0, right: 390 };
const bar = { top: 824, bottom: 900, left: 0, right: 390 };
const footer = { top: 870.48, bottom: 899.92, left: 20, right: 205 };

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
