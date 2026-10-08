import { hasAnalyticsConsent, measurementId } from "./consent";
import { productFacts } from "./product-facts";
import type { StoreProduct } from "./store-types";
export type AnalyticsEvent =
  | "page_view"
  | "view_item_list"
  | "select_item"
  | "view_item"
  | "add_to_cart"
  | "remove_from_cart"
  | "view_cart"
  | "begin_checkout"
  | "add_shipping_info"
  | "add_payment_info"
  | "generate_lead"
  | "search_no_results"
  | "contact_click";
type TagWindow = Window & {
  dataLayer: unknown[];
  gtag: (...args: unknown[]) => void;
  [key: `ga-disable-${string}`]: boolean;
};
let frame: HTMLIFrameElement | null = null;
let tag: TagWindow | null = null;
export function safePath(path: string) {
  const pathname = path.split(/[?#]/)[0];
  if (/^\/zamowienie\//.test(pathname)) return "/zamowienie/[id]";
  if (/^\/konto(?:\/|$)/.test(pathname)) return "/konto/[strona]";
  return pathname;
}
export function item(
  p: Pick<StoreProduct, "sku" | "id" | "name" | "priceCents"> &
    Partial<Pick<StoreProduct, "taxRate">>,
  quantity = 1,
) {
  return {
    item_id: p.sku || p.id,
    item_name: p.name,
    item_category: productFacts(p.name).series || "Inne",
    price:
      Math.round((p.priceCents * quantity * 100) / (100 + (p.taxRate ?? 0))) /
      100 /
      quantity,
    currency: "PLN",
    quantity,
  };
}
export function stopAnalytics() {
  if (tag) {
    tag[`ga-disable-${measurementId()}`] = true;
    tag.dataLayer.length = 0;
  }
  frame?.remove();
  frame = null;
  tag = null;
}
function startAnalytics() {
  if (tag) return tag;
  // A disposable same-origin realm prevents automatic history/form/link observers
  // from seeing checkout data, and lets withdrawal destroy the Google runtime.
  frame = document.createElement("iframe");
  frame.hidden = true;
  frame.title = "Statystyka";
  frame.setAttribute("aria-hidden", "true");
  frame.referrerPolicy = "no-referrer";
  document.body.appendChild(frame);
  tag = frame.contentWindow as TagWindow;
  const doc = tag.document;
  tag.dataLayer = [];
  tag.gtag = function () {
    tag?.dataLayer.push(arguments);
  };
  tag.gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  tag.gtag("consent", "update", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  tag.gtag("js", new Date());
  tag.gtag("config", measurementId(), {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_domain: location.hostname,
    cookie_path: "/",
    cookie_expires: 15552000,
    cookie_update: false,
    page_location: location.origin + safePath(location.pathname),
    page_referrer: "",
    page_title: "INNOCHEM",
  });
  const script = doc.createElement("script");
  script.async = true;
  script.referrerPolicy = "no-referrer";
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId())}`;
  doc.head.appendChild(script);
  return tag;
}
export function track(
  name: AnalyticsEvent,
  params: Record<string, unknown> = {},
) {
  if (
    typeof window === "undefined" ||
    !hasAnalyticsConsent() ||
    /^\/admin(?:\/|$)/.test(location.pathname)
  )
    return false;
  try {
    const path = safePath(location.pathname);
    startAnalytics().gtag("event", name, {
      ...params,
      page_location: location.origin + path,
      page_title: path.startsWith("/konto")
        ? "Konto — INNOCHEM"
        : path === "/zamowienie/[id]"
          ? "Zamówienie — INNOCHEM"
          : document.title,
      // Never allow document.referrer to expose an order token or reset URL.
      page_referrer:
        typeof params.page_referrer === "string" ? params.page_referrer : "",
    });
    return true;
  } catch {
    return false;
  }
}
