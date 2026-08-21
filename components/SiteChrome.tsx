"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart";

export function DemoBar() {
  return (
    <div className="demo-bar">
      WERSJA DEMONSTRACYJNA — projekt nowego sklepu innochem.pl przygotowany przez{" "}
      <strong>
        <a href="https://programo.pl">Programo</a>
      </strong>
      . Zamówienia nie są realizowane.
    </div>
  );
}

export function Header() {
  const { count } = useCart();
  const router = useRouter();
  return (
    <header className="site">
      <div className="wrap site-inner">
        <Link className="logo" href="/">
          INNO<span>CHEM</span>
          <em>Royal Purple Polska</em>
        </Link>
        <nav className="main" aria-label="Główna nawigacja">
          <Link href="/#kategorie">Kategorie</Link>
          <Link href="/produkt/hps-5w30">Produkt</Link>
          <Link href="/#technologia">Technologia</Link>
          <Link href="/#kontakt">Kontakt</Link>
        </nav>
        <button className="cart-btn" onClick={() => router.push("/zamowienie")}>
          Koszyk <span className="count">{count}</span>
        </button>
      </div>
    </header>
  );
}

const CATS: { label: string; items?: string[] }[] = [
  { label: "Oleje samochodowe", items: ["Oleje silnikowe", "Oleje przekładniowe", "Inne"] },
  { label: "Oleje motocyklowe" },
  { label: "Oleje wyścigowe" },
  { label: "Pojazdy śnieżne i traktory" },
  {
    label: "Oleje przemysłowe",
    items: ["Oleje i smary przekładniowe", "Smary do kompresorów", "Oleje do sprężarek", "Oleje hydrauliczne", "Inne płyny i oleje"],
  },
];

export function CatBar() {
  return (
    <nav className="catbar" aria-label="Kategorie produktów">
      <div className="wrap catbar-inner">
        {CATS.map((c) => (
          <div className={c.items ? "cb-item has-menu" : "cb-item"} key={c.label}>
            <Link href="/produkt/hps-5w30">
              {c.label}
              {c.items && <span className="cb-caret" aria-hidden>▾</span>}
            </Link>
            {c.items && (
              <div className="cb-menu">
                {c.items.map((i) => (
                  <Link href="/produkt/hps-5w30" key={i}>{i}</Link>
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="cb-item cb-dist">
          <a href="#kontakt">Zostań dystrybutorem</a>
        </div>
      </div>
    </nav>
  );
}

export function Footer({ full = false }: { full?: boolean }) {
  return (
    <footer className="site" id="kontakt">
      <div className="wrap">
        {full && (
          <div className="foot-grid">
            <div>
              <b>INNOCHEM</b>
              <p>
                Wyłączny dystrybutor olejów i smarów Royal Purple w Polsce od 2009 roku.
                <br />
                ul. Okrzei 64, 25-526 Kielce · pn–pt 8:00–16:00
                <br />
                kontakt@innochem.pl · tel. 602 155 919
              </p>
            </div>
            <div>
              <b>Sklep</b>
              <Link href="/#kategorie">Kategorie</Link>
              <Link href="/produkt/hps-5w30">Przykładowy produkt</Link>
              <Link href="/zamowienie">Koszyk</Link>
            </div>
            <div>
              <b>Informacje</b>
              <a href="#">Dostawa i zwroty</a>
              <a href="#">Regulamin</a>
              <a href="#">Polityka prywatności</a>
            </div>
            <div>
              <b>Współpraca</b>
              <a href="#">Zostań dystrybutorem</a>
              <a href="#">Baza wiedzy</a>
            </div>
          </div>
        )}
        <div className="foot-note">
          <span>© 2026 INNOCHEM. Wszystkie prawa zastrzeżone.</span>
          <span>
            Projekt demonstracyjny:{" "}
            <a href="https://programo.pl" style={{ display: "inline" }}>
              programo.pl
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
