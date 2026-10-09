import Link from "next/link";
import { phoneHref } from "@/lib/contact";
import type { SiteContent } from "@/lib/site-content";
import { PrivacySettingsButton } from "./PrivacySettingsButton";
/** Presentational chrome rendered on the server; only the privacy button hydrates. */
export function PreviewBar() {
  return (
    <div className="demo-bar">
      Podgląd nowego sklepu INNOCHEM. Zamówienia i wiadomości nie są
      realizowane.
    </div>
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
        <PrivacySettingsButton />
        <div className="foot-note">
          <span>
            © {new Date().getFullYear()} {brand.name}. {brand.copyright}{" "}
            <Link href="/odstapienie" className="foot-withdraw">
              Formularz odstąpienia od umowy
            </Link>
          </span>
          <a
            className="foot-credit"
            href="https://programo.pl"
            target="_blank"
            rel="noopener noreferrer"
          >
            Stworzone przez
            <img
              src="/programo-logo.svg"
              alt="Programo"
              width={78}
              height={11}
              loading="lazy"
            />
            <span>· Programo s.j., Poznań</span>
          </a>
        </div>
      </div>
    </footer>
  );
}
