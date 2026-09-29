"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { CONSENT_CHANGED, hasAnalyticsConsent } from "@/lib/consent";
import {
  safePath,
  stopAnalytics,
  track,
  type AnalyticsEvent,
} from "@/lib/analytics";
export function Analytics() {
  const pathname = usePathname();
  const last = useRef("");
  useEffect(() => {
    const visit = () => {
      if (!hasAnalyticsConsent() || pathname.startsWith("/admin")) {
        stopAnalytics();
        last.current = "";
        return;
      }
      if (last.current === pathname) return;
      const previous = last.current;
      if (
        track("page_view", {
          page_referrer: previous ? location.origin + safePath(previous) : "",
        })
      )
        last.current = pathname;
    };
    visit();
    window.addEventListener(CONSENT_CHANGED, visit);
    const contact = (e: MouseEvent) => {
      const href =
        (e.target as Element)?.closest?.("a")?.getAttribute("href") || "";
      if (/^(tel:|mailto:)/.test(href))
        track("contact_click", {
          channel: href.startsWith("tel:") ? "phone" : "email",
        });
    };
    document.addEventListener("click", contact);
    return () => {
      window.removeEventListener(CONSENT_CHANGED, visit);
      document.removeEventListener("click", contact);
    };
  }, [pathname]);
  return null;
}
export function useViewEvent(
  name: AnalyticsEvent,
  params: Record<string, unknown>,
  enabled = true,
) {
  const sent = useRef("");
  const serialized = JSON.stringify(params);
  useEffect(() => {
    const send = () => {
      if (
        enabled &&
        sent.current !== serialized &&
        track(name, JSON.parse(serialized))
      )
        sent.current = serialized;
    };
    send();
    window.addEventListener(CONSENT_CHANGED, send);
    return () => window.removeEventListener(CONSENT_CHANGED, send);
  }, [name, serialized, enabled]);
}
export function ViewEvent({
  name,
  params,
}: {
  name: AnalyticsEvent;
  params: Record<string, unknown>;
}) {
  useViewEvent(name, params);
  return null;
}
