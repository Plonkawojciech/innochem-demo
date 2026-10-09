"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import { useCartActions } from "@/lib/cart";
import {
  cartConfirmation,
  type CartConfirmation,
} from "@/lib/cart-confirmation";
import type { ProductCardData } from "@/lib/store-types";

type Dialog = ComponentType<{
  added: CartConfirmation;
  onDismiss: () => void;
}>;
let dialogLoad: Promise<{ AddToCartDialog: Dialog }> | null = null;
function loadDialog() {
  // No import, CSS fetch or prefetch until an add has actually changed the cart.
  return (dialogLoad ??= import("./AddToCartDialog"));
}

/** Cart changes synchronously; loading its confirmation never retries the add. */
export function useAddToCart() {
  const { add } = useCartActions();
  return (
    product: ProductCardData,
    quantity: number,
    trigger?: HTMLElement,
  ) => {
    const result = add(product.id, quantity, product);
    if (result.delta > 0) {
      const pathname = window.location.pathname;
      cartConfirmation.publish(
        { product, result, trigger: trigger ?? null, pathname },
        pathname,
      );
    }
    return result;
  };
}

export function AddToCartPopup() {
  const pathname = usePathname();
  const [added, setAdded] = useState<CartConfirmation | null>(null);
  const [Dialog, setDialog] = useState<Dialog | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // A delayed effect from an intermediate route must not consume a current add.
    if (window.location.pathname !== pathname) return;
    setAdded((current) => (current?.pathname === pathname ? current : null));
    return cartConfirmation.subscribe(pathname, (next) => {
      if (window.location.pathname === pathname) setAdded(next);
    });
  }, [pathname]);

  useEffect(() => {
    if (!added || added.pathname !== pathname || Dialog) return;
    let active = true;
    loadDialog().then(
      ({ AddToCartDialog }) => {
        if (active && window.location.pathname === pathname)
          setDialog(() => AddToCartDialog);
      },
      () => {
        if (active && window.location.pathname === pathname) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [added, pathname, Dialog]);

  // A route render cancels the old dialog before effects or an import can finish.
  if (!added || added.pathname !== pathname) return null;
  const dismiss = () =>
    setAdded((current) => (current === added ? null : current));
  if (Dialog) return <Dialog added={added} onDismiss={dismiss} />;
  if (!failed) return null;

  return (
    <aside
      role="status"
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        maxWidth: "min(28rem, calc(100% - 32px))",
        padding: 16,
        border: "1px solid var(--line)",
        borderRadius: 8,
        background: "var(--panel)",
        color: "var(--ink)",
        zIndex: 100,
      }}
    >
      <p>
        Dodano do koszyka: {added.product.name}, {added.result.delta} szt.
      </p>
      <a href="/zamowienie">Zobacz koszyk</a>{" "}
      <button
        type="button"
        onClick={() => {
          dismiss();
          const trigger = added.trigger;
          const target =
            trigger?.isConnected && !trigger.matches(":disabled")
              ? trigger
              : document.querySelector<HTMLElement>("header.site .cart-btn");
          target?.focus();
        }}
      >
        Zamknij
      </button>
    </aside>
  );
}
