"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  CONSENT_CHANGED,
  CONSENT_KEY,
  PRIVACY_OPEN,
  clearGoogleCookies,
  hasAnalyticsConsent,
  measurementId,
  readConsent,
  retryRevocation,
  saveConsent,
} from "@/lib/consent";
import { stopAnalytics } from "@/lib/analytics";
export function ConsentBanner() {
  const configured = !!measurementId();
  const pathname = usePathname();
  const [open, setOpen] = useState(configured);
  const [settings, setSettings] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const visible = open && !pathname.startsWith("/admin");
  useEffect(() => {
    setOpen(configured && !readConsent());
    const show = () => {
      setAnalytics(hasAnalyticsConsent());
      setSettings(true);
      setOpen(true);
    };
    const sync = () => {
      void retryRevocation().catch(() => {
        setError(
          "Statystyka jest wyłączona w tej przeglądarce. Zapisz wybór ponownie, aby potwierdzić wycofanie na serwerze.",
        );
        setAnalytics(false);
        setSettings(true);
        setOpen(true);
      });
      if (!hasAnalyticsConsent()) {
        stopAnalytics();
        clearGoogleCookies();
      }
      if (configured && !readConsent()) setOpen(true);
      window.dispatchEvent(new Event(CONSENT_CHANGED));
    };
    const storage = (e: StorageEvent) => {
      if (e.key === CONSENT_KEY) sync();
    };
    window.addEventListener(PRIVACY_OPEN, show);
    window.addEventListener("storage", storage);
    window.addEventListener("focus", sync);
    const timer = setInterval(sync, 30000);
    sync();
    return () => {
      clearInterval(timer);
      window.removeEventListener(PRIVACY_OPEN, show);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", sync);
    };
  }, [configured]);
  useEffect(() => {
    if (!visible || !dialog.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = dialog.current;
    // Inert siblings support pointer and screen-reader isolation as well as Tab.
    const siblings = Array.from(document.body.children).filter(
      (x) => x instanceof HTMLElement && x !== el.parentElement,
    ) as HTMLElement[];
    const old = siblings.map((x) => x.inert);
    siblings.forEach((x) => {
      x.inert = true;
    });
    el.querySelector<HTMLElement>("button, a")?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        return;
      }
      if (e.key !== "Tab") return;
      const all = Array.from(
        el.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], input:not(:disabled)",
        ),
      );
      const first = all[0],
        last = all[all.length - 1];
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          !el.contains(document.activeElement))
      ) {
        e.preventDefault();
        last?.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last ||
          !el.contains(document.activeElement))
      ) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      siblings.forEach((x, i) => {
        x.inert = old[i];
      });
      previous?.focus();
    };
  }, [visible, settings]);
  async function choose(value: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await saveConsent(value);
      setOpen(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Nie udało się zapisać ustawień. Spróbuj ponownie.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!visible) return null;
  return (
    <div className="consent-backdrop">
      <div
        ref={dialog}
        className="consent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        aria-describedby="consent-description"
      >
        <h2 id="consent-title" className="display">
          Ustawienia prywatności
        </h2>
        <p id="consent-description">
          {configured
            ? "INNOCHEM Aneta Zalewska korzysta z cookies i pamięci przeglądarki potrzebnych do działania sklepu, koszyka i konta. Za Twoją zgodą włączymy również Google Analytics, aby sprawdzać, jak odwiedzający korzystają ze sklepu i które wizyty prowadzą do zakupów. Dane analityczne otrzyma Google; szczegóły ich przetwarzania i możliwego przekazywania poza EOG opisujemy w polityce prywatności."
            : "Sklep używa wyłącznie danych niezbędnych do działania koszyka, konta i zapisania Twoich ustawień. Statystyka odwiedzin jest wyłączona."}
        </p>
        {configured && (
          <p>
            Możesz odmówić bez wpływu na zakupy. Wybór zmienisz w każdej chwili
            przez „Ustawienia prywatności” w stopce.
          </p>
        )}
        {settings && (
          <div className="consent-categories">
            <div>
              <b>Niezbędne — zawsze aktywne</b>
              <p>
                Utrzymują koszyk, logowanie, bezpieczeństwo i zapis Twoich
                ustawień prywatności. Nie służą reklamie ani statystykom
                odwiedzin.
              </p>
            </div>
            {configured && (
              <label>
                <span>
                  <b>Statystyka</b>
                  <span>
                    Google Analytics pomaga ocenić korzystanie ze sklepu i
                    zakupy. Włączymy je dopiero po Twojej zgodzie. Odmowa nie
                    ogranicza zakupów.
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={analytics}
                  onChange={(e) => setAnalytics(e.target.checked)}
                />
              </label>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {error && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setOpen(false)}
          >
            Kontynuuj bez statystyki
          </button>
        )}
        <div className="consent-actions">
          {!configured ? (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setOpen(false)}
            >
              Zamknij
            </button>
          ) : settings ? (
            <button
              type="button"
              className="btn btn-outline"
              disabled={busy}
              onClick={() => choose(analytics)}
            >
              Zapisz wybór
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-outline"
                disabled={busy}
                onClick={() => choose(false)}
              >
                Odrzuć opcjonalne
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={busy}
                onClick={() => setSettings(true)}
              >
                Ustawienia
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={busy}
                onClick={() => choose(true)}
              >
                Akceptuj wszystkie
              </button>
            </>
          )}
        </div>
        <div className="consent-links">
          <Link href="/polityka-cookies" target="_blank">
            Polityka cookies
          </Link>
          <Link href="/polityka-prywatnosci" target="_blank">
            Polityka prywatności
          </Link>
        </div>
      </div>
    </div>
  );
}
