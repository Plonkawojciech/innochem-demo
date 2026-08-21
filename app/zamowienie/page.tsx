"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PRODUCTS, zl } from "@/lib/products";
import { Footer } from "@/components/SiteChrome";
import { useCart } from "@/lib/cart";

const SHIPPING = [
  { id: "dpd", label: "Kurier DPD", note: "doręczenie następnego dnia roboczego", price: 15.9 },
  { id: "inpost", label: "Paczkomat InPost", note: "odbiór 24/7", price: 11.9 },
  { id: "odbior", label: "Odbiór osobisty", note: "po wcześniejszym umówieniu", price: 0 },
];

export default function Zamowienie() {
  const { cart, add, clear } = useCart();
  const [ship, setShip] = useState(SHIPPING[0]);
  const [done, setDone] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // demo: pusty koszyk dostaje bestseller, żeby ścieżka była klikalna od razu
  useEffect(() => {
    if (!seeded) {
      setSeeded(true);
      return;
    }
    if (!done && Object.keys(cart).length === 0) add("hps-5w30");
  }, [seeded, cart, done, add]);

  const items = Object.entries(cart)
    .map(([id, qty]) => ({ p: PRODUCTS.find((x) => x.id === id)!, qty }))
    .filter((x) => x.p);
  const sum = items.reduce((a, x) => a + x.p.price * x.qty, 0);

  const order = () => {
    setDone(true);
    clear();
    window.scrollTo(0, 0);
  };

  if (done) {
    return (
      <>
        <div className="wrap success">
          <div className="mark" aria-hidden="true">✓</div>
          <h1 className="display">Zamówienie przyjęte</h1>
          <p>
            Dziękujemy. W prawdziwym sklepie klient otrzymałby teraz e-mail z potwierdzeniem i numerem
            zamówienia, a płatność przeszłaby przez bramkę BLIK / Przelewy24. To koniec ścieżki
            demonstracyjnej.
          </p>
          <Link className="btn btn-violet" href="/">
            Wróć do sklepu
          </Link>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <div className="wrap">
        <div className="steps" role="list">
          <div className="step on" role="listitem">
            <span className="mono">KROK 1</span>Koszyk i dane
          </div>
          <div className="step" role="listitem">
            <span className="mono">KROK 2</span>Dostawa i płatność
          </div>
          <div className="step" role="listitem">
            <span className="mono">KROK 3</span>Potwierdzenie
          </div>
        </div>

        <div className="chk">
          <div>
            <div className="panel" style={{ marginBottom: 24 }}>
              <h2 className="display">Dane zamawiającego</h2>
              <div className="f-grid">
                <label className="f">
                  Imię
                  <input placeholder="Jan" />
                </label>
                <label className="f">
                  Nazwisko
                  <input placeholder="Kowalski" />
                </label>
                <label className="f full">
                  E-mail
                  <input type="email" placeholder="jan@przyklad.pl" />
                </label>
                <label className="f">
                  Telefon
                  <input placeholder="+48" />
                </label>
                <label className="f">
                  NIP (opcjonalnie — faktura VAT)
                  <input placeholder="000-000-00-00" />
                </label>
                <label className="f full">
                  Adres
                  <input placeholder="Ulica i numer" />
                </label>
                <label className="f">
                  Kod pocztowy
                  <input placeholder="00-000" />
                </label>
                <label className="f">
                  Miasto
                  <input placeholder="Poznań" />
                </label>
              </div>
            </div>

            <div className="panel">
              <h2 className="display">Dostawa i płatność</h2>
              <div className="ship-opts">
                {SHIPPING.map((s) => (
                  <label className="opt" key={s.id}>
                    <input
                      type="radio"
                      name="ship"
                      checked={ship.id === s.id}
                      onChange={() => setShip(s)}
                    />
                    <div>
                      <b>{s.label}</b>
                      <span>{s.note}</span>
                    </div>
                    <span className="p">{zl(s.price)}</span>
                  </label>
                ))}
              </div>
              <div className="ship-opts" style={{ marginTop: 18 }}>
                <label className="opt">
                  <input type="radio" name="pay" defaultChecked />
                  <div>
                    <b>Płatność online</b>
                    <span>BLIK, szybki przelew, karta</span>
                  </div>
                </label>
                <label className="opt">
                  <input type="radio" name="pay" />
                  <div>
                    <b>Za pobraniem</b>
                    <span>płatność przy odbiorze</span>
                  </div>
                </label>
              </div>
            </div>
          </div>

          <aside className="panel">
            <h2 className="display">Twoje zamówienie</h2>
            <div>
              {items.map(({ p, qty }) => (
                <div className="cart-item" key={p.id}>
                  <img src={p.img} alt="" />
                  <div>
                    <b>
                      {p.name} {p.visc}
                    </b>
                    <span>
                      {p.vol} · {qty} szt.
                    </span>
                  </div>
                  <span className="p">{zl(p.price * qty)}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14 }}>
              <div className="sum-line">
                <span>Produkty</span>
                <span>{zl(sum)}</span>
              </div>
              <div className="sum-line">
                <span>Dostawa</span>
                <span>{zl(ship.price)}</span>
              </div>
              <div className="sum-line total">
                <span>Razem</span>
                <span>{zl(sum + ship.price)}</span>
              </div>
            </div>
            <button className="btn btn-primary" style={{ width: "100%", marginTop: 20 }} onClick={order}>
              Zamawiam i płacę
            </button>
            <p className="ship-note" style={{ textAlign: "center" }}>
              To demo — płatność nie zostanie pobrana.
            </p>
          </aside>
        </div>
      </div>
      <Footer />
    </>
  );
}
