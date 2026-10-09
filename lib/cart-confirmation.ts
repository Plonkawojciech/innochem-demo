import type { CartResult } from "./cart-state";
import type { ProductCardData } from "./store-types";

export type CartConfirmation = {
  product: ProductCardData;
  result: CartResult;
  trigger: HTMLElement | null;
  pathname: string;
};

/** One confirmation, even if an add happens before the global popup mounts. */
export function createCartConfirmationBridge() {
  let pending: CartConfirmation | null = null;
  let subscriber: {
    pathname: string;
    notify: (added: CartConfirmation) => void;
  } | null = null;

  return {
    publish(added: CartConfirmation) {
      if (added.result.delta <= 0) return;
      if (!subscriber) pending = added;
      else if (subscriber.pathname === added.pathname) subscriber.notify(added);
    },
    subscribe(pathname: string, notify: (added: CartConfirmation) => void) {
      const current = { pathname, notify };
      subscriber = current;
      const added = pending;
      pending = null;
      if (added?.pathname === pathname) notify(added);
      return () => {
        // A replaced subscription's cleanup must not detach its successor.
        if (subscriber === current) subscriber = null;
      };
    },
  };
}

export const cartConfirmation = createCartConfirmationBridge();
