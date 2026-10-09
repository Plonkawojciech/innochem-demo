import test from "node:test";
import assert from "node:assert/strict";
import { subscribeMenuFocusDismiss } from "../lib/menu-focus";

function fixture() {
  const events = new EventTarget();
  const burger = new EventTarget();
  const logo = new EventTarget();
  const cart = new EventTarget();
  const links = Array.from({ length: 24 }, () => new EventTarget());
  const header = new Set([burger, logo, cart, ...links]);
  const search = new EventTarget();
  let active: EventTarget | null = burger;
  let open = true;
  let dismissals = 0;
  const subscribe = () =>
    subscribeMenuFocusDismiss(
      events,
      (target) => target !== null && header.has(target),
      () => {
        open = false;
        dismissals++;
      },
    );
  const focus = (target: EventTarget) => {
    active = target;
    const event = new Event("focusin", { bubbles: true });
    Object.defineProperty(event, "target", { value: target });
    events.dispatchEvent(event);
  };
  return {
    burger,
    logo,
    cart,
    links,
    search,
    focus,
    subscribe,
    get active() {
      return active;
    },
    get open() {
      return open;
    },
    get dismissals() {
      return dismissals;
    },
  };
}

test("tabbing through the header and every menu link keeps the menu open", () => {
  const state = fixture();
  const stop = state.subscribe();
  for (const target of [
    state.burger,
    state.logo,
    state.cart,
    ...state.links,
    ...state.links.toReversed(),
    state.burger,
  ]) {
    state.focus(target);
    assert.equal(state.open, true);
    assert.equal(state.active, target);
  }
  assert.equal(state.dismissals, 0);
  stop();
});

test("leaving the menu uncovers the search without stealing its focus", () => {
  const state = fixture();
  const stop = state.subscribe();
  state.focus(state.links.at(-1)!);
  state.focus(state.search);
  assert.equal(state.open, false);
  assert.equal(state.active, state.search);
  assert.equal(state.dismissals, 1);
  stop();
});

test("moving backwards or programmatically to an outside control also dismisses", () => {
  const state = fixture();
  const stop = state.subscribe();
  state.focus(state.burger);
  const previousPageControl = new EventTarget();
  state.focus(previousPageControl);
  assert.equal(state.open, false);
  assert.equal(state.active, previousPageControl);
  assert.equal(state.dismissals, 1);
  stop();
});

test("closing or unmounting removes the listener, including repeated open cycles", () => {
  const state = fixture();
  const stopFirst = state.subscribe();
  stopFirst();
  state.focus(state.search);
  assert.equal(state.dismissals, 0);
  const stopSecond = state.subscribe();
  state.focus(state.search);
  assert.equal(state.dismissals, 1);
  stopSecond();
  state.focus(state.search);
  assert.equal(state.dismissals, 1);
});
