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
  let pathname = path.split(/[?#]/)[0];
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return "/[strona]";
  }
  if (/^\/+zamowienie\//i.test(pathname)) return "/zamowienie/[id]";
  if (/^\/+konto(?:\/|$)/i.test(pathname)) return "/konto/[strona]";
  if (/^\/+admin(?:\/|$)/i.test(pathname)) return "/admin/[strona]";
  if (!/^\/[a-z0-9/_.-]*$/i.test(pathname) || pathname.length > 512)
    return "/[strona]";
  return pathname;
}
const campaignKeys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;
export function safeCampaignQuery(path: string, search: string) {
  const pathname = safePath(path);
  if (
    /^\/(?:konto|zamowienie|admin)(?:\/|$)/i.test(pathname) ||
    pathname === "/[strona]" ||
    search.length > 2048
  )
    return "";
  const input = new URLSearchParams(search);
  const output = new URLSearchParams();
  for (const key of campaignKeys) {
    const values = input.getAll(key);
    if (values.length !== 1) continue;
    const value = values[0];
    // Campaign labels, not contact data, click identifiers or arbitrary URLs.
    // Reject UUID/hex tokens and phone-like digit runs even when slug-shaped.
    if (
      !/^[a-z][a-z0-9_-]{0,63}$/i.test(value) ||
      /\d{7}|[a-f0-9]{16}|[a-f0-9]{8}-[a-f0-9]{4}-/i.test(value) ||
      /(?:^|[_-])(?:token|password|passwd|session|secret|auth)(?:$|[_-])/i.test(
        value,
      )
    )
      continue;
    output.set(key, value);
  }
  const query = output.toString();
  return query ? `?${query}` : "";
}
export function safePageLocation(origin: string, path: string, search = "") {
  return origin + safePath(path) + safeCampaignQuery(path, search);
}
export function safeReferrer(
  referrer: string,
  origin: string,
  allowInternal = false,
) {
  if (
    !referrer ||
    referrer.length > 2048 ||
    /[\u0000-\u0020\u007f]/.test(referrer)
  )
    return "";
  try {
    const url = new URL(referrer);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password)
      return "";
    if (url.origin !== origin) return url.origin;
    return allowInternal ? origin + safePath(url.pathname) : "";
  } catch {
    return "";
  }
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
  // Observers run in an empty document rather than checkout DOM/history.
  // This same-origin realm is not a security sandbox against hostile scripts.
  // Withdrawal destroys the entire runtime; every URL below is explicit.
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
    page_location: safePageLocation(
      location.origin,
      location.pathname,
      location.search,
    ),
    page_referrer: safeReferrer(document.referrer, location.origin),
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
    safePath(location.pathname).startsWith("/admin/")
  )
    return false;
  try {
    const path = safePath(location.pathname);
    startAnalytics().gtag("event", name, {
      ...params,
      page_location: safePageLocation(
        location.origin,
        location.pathname,
        location.search,
      ),
      page_title: path.startsWith("/konto")
        ? "Konto — INNOCHEM"
        : /^\/zamowienie(?:\/|$)/i.test(path)
          ? "Zamówienie — INNOCHEM"
          : path === "/[strona]"
            ? "INNOCHEM"
            : document.title,
      // Callers cannot override URL privacy with a raw referrer or page_location.
      page_referrer: safeReferrer(
        typeof params.page_referrer === "string"
          ? params.page_referrer
          : document.referrer,
        location.origin,
        typeof params.page_referrer === "string",
      ),
    });
    return true;
  } catch {
    return false;
  }
}
