"use client";
import Link from "next/link";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { cartLimitMessage } from "@/lib/cart-state";
import { useCart } from "@/lib/cart";
import type { CartConfirmation } from "@/lib/cart-confirmation";
import { mediaSrc, mediaSrcSet } from "@/lib/media";
import { productFacts } from "@/lib/product-facts";
import { money } from "@/lib/store-types";
import s from "./AddToCartPopup.module.css";
const FOCUSABLE = "a[href], button:not(:disabled)";
export function AddToCartDialog({
  added,
  onDismiss,
}: {
  added: CartConfirmation;
  onDismiss: () => void;
}) {
  const { count } = useCart();
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const restore = useRef(true);
  const pressedBackdrop = useRef(false);
  useLayoutEffect(() => {
    const el = dialog.current;
    return () => {
      // Route changes unmount the dialog without focusing the old page's controls.
      restore.current = false;
      if (el?.open) el.close();
    };
  }, []);
  useLayoutEffect(() => {
    const el = dialog.current;
    if (!added || !el) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    restore.current = true;
    // Apply the page lock before showModal's synchronous layout and focus steps.
    root.style.overflow = "hidden";
    // Let native dialog focusing select the intended control in a single step.
    keep.current?.setAttribute("autofocus", "");
    try {
      if (!el.open) el.showModal();
      if (document.activeElement !== keep.current)
        keep.current?.focus({ preventScroll: true });
    } catch (error) {
      root.style.overflow = previous;
      throw error;
    }
    return () => {
      root.style.overflow = previous;
    };
  }, [added]);
  const close = (returnFocus: boolean) => {
    restore.current = returnFocus;
    dialog.current?.close();
  };
  return (
    <dialog
      ref={dialog}
      className={s.dialog}
      aria-labelledby="atc-title"
      aria-describedby="atc-summary"
      onClose={(e) => {
        // Ignore a queued close from Strict Mode's cleanup if it already reopened.
        if (e.currentTarget.open) return;
        const trigger = added?.trigger;
        onDismiss();
        if (!restore.current) return;
        // A trigger that became disabled or was replaced hands focus to the header cart.
        const target =
          trigger?.isConnected && !trigger.matches(":disabled")
            ? trigger
            : document.querySelector<HTMLElement>("header.site .cart-btn");
        target?.focus();
      }}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget)
          close(true);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const all = Array.from(
          e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE),
        );
        const first = all[0];
        const last = all[all.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
    >
      {added && (
        <Content added={added} count={count} keep={keep} onClose={close} />
      )}
    </dialog>
  );
}
function Content({
  added: { product: p, result },
  count,
  keep,
  onClose,
}: {
  added: CartConfirmation;
  count: number;
  keep: RefObject<HTMLButtonElement | null>;
  onClose: (returnFocus: boolean) => void;
}) {
  const facts = productFacts(p.name);
  const note = cartLimitMessage(result);
  return (
    <div className={s.sheet}>
      <div className={s.head}>
        <p className={s.status} id="atc-title">
          <svg viewBox="0 0 20 20" aria-hidden="true" className={s.tick}>
            <path d="M5 10.5l3.2 3.2L15 7" />
          </svg>
          {result.limit ? "Dodano część ilości" : "Dodano do koszyka"}
        </p>
        <button
          type="button"
          className={s.close}
          aria-label="Zamknij"
          onClick={() => onClose(true)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>
      <div className={s.product}>
        <div className={s.photo}>
          {p.imagePath ? (
            <img
              src={mediaSrc(p.imagePath, 160)}
              srcSet={mediaSrcSet(p.imagePath, [160, 320])}
              sizes="88px"
              alt=""
              width={88}
              height={88}
            />
          ) : null}
        </div>
        <div className={s.info}>
          {facts.series && <span className={s.series}>{facts.series}</span>}
          <p className={s.name}>{p.name}</p>
          <dl className={s.facts} id="atc-summary">
            <div>
              <dt>Dodano</dt>
              <dd>{result.delta} szt.</dd>
            </div>
            <div>
              <dt>Cena</dt>
              <dd>{money(p.priceCents)} / szt.</dd>
            </div>
            <div>
              <dt>Ten produkt w koszyku</dt>
              <dd>{result.quantity} szt.</dd>
            </div>
          </dl>
        </div>
      </div>
      {note && <p className={s.note}>{note}</p>}
      <div className={s.actions}>
        <Link
          href="/zamowienie"
          className={`btn ${s.primary}`}
          onClick={() => onClose(false)}
        >
          Zobacz koszyk
          <span className={s.count} aria-hidden="true">
            {count}
          </span>
          <span className="sr-only">, w koszyku łącznie {count} szt.</span>
        </Link>
        <button
          ref={keep}
          type="button"
          className={`btn ${s.secondary}`}
          onClick={() => onClose(true)}
        >
          Kontynuuj zakupy
        </button>
      </div>
    </div>
  );
}
