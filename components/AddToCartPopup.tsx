"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { cartLimitMessage, type CartResult } from "@/lib/cart-state";
import { useCart } from "@/lib/cart";
import { mediaSrc, mediaSrcSet } from "@/lib/media";
import { productFacts } from "@/lib/product-facts";
import { money, type StoreProduct } from "@/lib/store-types";
import s from "./AddToCartPopup.module.css";
type Added = {
  product: StoreProduct;
  result: CartResult;
  trigger: HTMLElement | null;
};
let show: ((added: Added) => void) | null = null;
/**
 * Adds to the cart and opens the global confirmation only when the cart really
 * changed. Callers get the result to explain a rejected or capped add inline.
 */
export function useAddToCart() {
  const { add } = useCart();
  return (product: StoreProduct, quantity: number, trigger?: HTMLElement) => {
    const result = add(product.id, quantity, product);
    if (result.delta > 0) show?.({ product, result, trigger: trigger ?? null });
    return result;
  };
}
const FOCUSABLE = "a[href], button:not(:disabled)";
export function AddToCartPopup() {
  const { count } = useCart();
  const [added, setAdded] = useState<Added | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const restore = useRef(true);
  const pressedBackdrop = useRef(false);
  const pathname = usePathname();
  useEffect(() => {
    show = (next) => {
      restore.current = true;
      setAdded(next);
    };
    return () => {
      show = null;
    };
  }, []);
  useLayoutEffect(() => {
    const el = dialog.current;
    if (!added || !el) return;
    if (!el.open) el.showModal();
    keep.current?.focus();
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [added]);
  useEffect(() => {
    restore.current = false;
    dialog.current?.close();
  }, [pathname]);
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
      onClose={() => {
        const trigger = added?.trigger;
        setAdded(null);
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
  added: Added;
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
