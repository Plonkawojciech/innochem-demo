"use client";
import { useSyncExternalStore } from "react";
type Theme = "light" | "dark";
function current(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
function subscribe(update: () => void) {
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}
function serverTheme(): Theme {
  return "light";
}
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, current, serverTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={next === "dark" ? "Włącz tryb ciemny" : "Włącz tryb jasny"}
      // The boot controller can update these attributes before hydration.
      suppressHydrationWarning
    >
      <svg
        className="theme-dark"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
      </svg>
      <svg
        className="theme-light"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
      <span className="theme-dark">Jasny</span>
      <span className="theme-light">Ciemny</span>
    </button>
  );
}
