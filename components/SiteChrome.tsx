"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart";
import { phoneHref, type SiteContent } from "@/lib/site-content";
export function PreviewBar() {
  return (
    <div className="demo-bar">
      Podgląd nowego sklepu INNOCHEM. Zamówienia i wiadomości nie są
      realizowane.
    </div>
  );
}
export function CmsPreviewBar() {
  const [error, setError] = useState("");
  const router = useRouter();
  return (
    <div className="cms-preview-bar">
      <span>Oglądasz zapisany szkic witryny.</span>{" "}
      <Link href="/admin/witryna">Wróć do edycji</Link>
      <button
        type="button"
        onClick={async () => {
          try {
            const r = await fetch("/api/admin/site-preview", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enabled: false }),
            });
            if (!r.ok) throw new Error();
            router.refresh();
          } catch {
            setError("Nie udało się wyłączyć podglądu. Spróbuj ponownie.");
          }
        }}
      >
        Zakończ podgląd
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
export function Header({
  brand,
  navigation,
}: Pick<SiteContent, "brand" | "navigation">) {
  const { count } = useCart();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, []);
  return (
    <header className="site">
      <div className="wrap site-inner">
        <button
          className={open ? "burger is-open" : "burger"}
          aria-label={open ? "Zamknij menu" : "Otwórz menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen(!open)}
        >
          <span />
          <span />
          <span />
        </button>
        <Link className="logo" href="/">
          {brand.logo.path ? (
            <img
              src={brand.logo.path}
              alt={brand.logo.alt || brand.name}
              className="brand-logo"
            />
          ) : brand.name === "INNOCHEM" ? (
            <>
              INNO<span>CHEM</span>
            </>
          ) : (
            brand.name
          )}
          <em>{brand.tagline}</em>
        </Link>
        <nav className="main" aria-label="Główna nawigacja">
          {navigation.main.map((l, i) => (
            <Link href={l.href} key={i}>
              {l.name}
            </Link>
          ))}
        </nav>
        <Link className="cart-btn" href="/zamowienie">
          Koszyk <span className="count">{count}</span>
        </Link>
      </div>
      {open && (
        <nav className="m-menu" id="mobile-menu" aria-label="Menu mobilne">
          {navigation.categories.map((c, i) => (
            <div key={i}>
              <Link className="m-cat" href={c.href}>
                {c.name}
              </Link>
              {!!c.items.length && (
                <div className="m-sub">
                  {c.items.map((l, j) => (
                    <Link href={l.href} key={j}>
                      {l.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
          {navigation.main.map((l, i) => (
            <Link className="m-cat" href={l.href} key={i}>
              {l.name}
            </Link>
          ))}
          <Link className="m-dist" href={navigation.highlighted.href}>
            {navigation.highlighted.name}
          </Link>
        </nav>
      )}
    </header>
  );
}
export function CatBar({ navigation }: Pick<SiteContent, "navigation">) {
  return (
    <nav className="catbar" aria-label="Kategorie produktów">
      <div className="wrap catbar-inner">
        {navigation.categories.map((c, i) => (
          <div
            className={c.items.length ? "cb-item has-menu" : "cb-item"}
            key={i}
          >
            <Link href={c.href}>
              {c.name}
              {!!c.items.length && (
                <span className="cb-caret" aria-hidden>
                  ▾
                </span>
              )}
            </Link>
            {!!c.items.length && (
              <div className="cb-menu">
                {c.items.map((l, j) => (
                  <Link key={j} href={l.href}>
                    {l.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="cb-item cb-dist">
          <Link href={navigation.highlighted.href}>
            {navigation.highlighted.name}
          </Link>
        </div>
      </div>
    </nav>
  );
}
export function Footer({
  brand,
  contact,
  footer,
}: Pick<SiteContent, "brand" | "contact" | "footer">) {
  return (
    <footer className="site" id="kontakt">
      <div className="wrap">
        <div className="foot-grid">
          <div>
            <b>{brand.name}</b>
            <p className="preserve-lines">
              {brand.footerText}
              <br />
              {contact.address}
              <br />
              {contact.hours}
            </p>
            <a href={`mailto:${contact.email}`}>{contact.email}</a>
            <a href={phoneHref(contact.phone)}>{contact.phone}</a>
          </div>
          {footer.map((group, i) => (
            <div key={i}>
              <b>{group.title}</b>
              {group.links.map((l, j) => (
                <Link href={l.href} key={j}>
                  {l.name}
                </Link>
              ))}
            </div>
          ))}
        </div>
        <p>
          <Link href="/odstapienie">Odstąp od umowy</Link>
        </p>
        <div className="foot-note">
          <span>
            © {new Date().getFullYear()} {brand.name}. {brand.copyright}
          </span>
          <a href="https://programo.pl">Wykonanie: Programo</a>
        </div>
      </div>
    </footer>
  );
}
