"use client";
import { useState, type FormEvent } from "react";
import type { StoreSettings } from "@/lib/server/settings";
export function SettingsEditor({
  value,
  version: initialVersion,
}: {
  value: StoreSettings;
  version: number;
}) {
  const [shipping, setShipping] = useState(value.shippingMethods);
  const [version, setVersion] = useState(initialVersion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) || "");
    const body = {
      version,
      value: {
        ...value,
        shippingMethods: shipping,
        paymentMethods: f.getAll("paymentMethods"),
        bankAccount: s("bankAccount"),
        orderEmail: s("orderEmail"),
        contactEmail: s("contactEmail"),
        termsVersion: s("termsVersion"),
        checkoutEnabled: f.get("checkoutEnabled") === "on",
        shippingApproved: f.get("shippingApproved") === "on",
        legalApproved: f.get("legalApproved") === "on",
      },
    };
    try {
      const r = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setVersion(d.version);
      setMessage("Zapisano ustawienia.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Nie udało się zapisać ustawień.",
      );
    } finally {
      setBusy(false);
    }
  }
  const change = (
    i: number,
    p: Partial<StoreSettings["shippingMethods"][number]>,
  ) =>
    setShipping((list) =>
      list.map((s, index) => (index === i ? { ...s, ...p } : s)),
    );
  return (
    <form onSubmit={submit}>
      <section className="panel">
        <h3>Dostawy</h3>
        {shipping.length === 0 && (
          <p>Nie wybrano jeszcze metod ani cen dostawy.</p>
        )}
        {shipping.map((s, i) => (
          <fieldset className="shipping-editor" key={i}>
            <legend>Metoda {i + 1}</legend>
            <div className="field-grid">
              <label className="f">
                Nazwa
                <input
                  value={s.label}
                  required
                  maxLength={100}
                  onChange={(e) => change(i, { label: e.target.value })}
                />
              </label>
              <label className="f">
                Identyfikator
                <input
                  value={s.id}
                  required
                  pattern="[a-z0-9-]+"
                  onChange={(e) => change(i, { id: e.target.value })}
                />
              </label>
              <label className="f">
                Cena (zł)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  max="1000"
                  required
                  value={s.priceCents / 100}
                  onChange={(e) =>
                    change(i, {
                      priceCents: Math.round(Number(e.target.value) * 100),
                    })
                  }
                />
              </label>
              <label className="f">
                Limit masy (g, 0 = bez limitu)
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={s.maxWeightGrams}
                  onChange={(e) =>
                    change(i, { maxWeightGrams: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={(e) => change(i, { enabled: e.target.checked })}
              />
              Aktywna
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={s.cod}
                onChange={(e) => change(i, { cod: e.target.checked })}
              />
              Umożliwia pobranie
            </label>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                setShipping((list) => list.filter((_, index) => index !== i))
              }
            >
              Usuń metodę z konfiguracji
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="btn btn-outline"
          disabled={shipping.length >= 20}
          onClick={() =>
            setShipping((list) => [
              ...list,
              {
                id: "",
                label: "",
                priceCents: 0,
                maxWeightGrams: 0,
                cod: false,
                enabled: false,
              },
            ])
          }
        >
          Dodaj metodę dostawy
        </button>
      </section>
      <section className="panel">
        <h3>Płatności</h3>
        {[
          ["bank_transfer", "Przelew tradycyjny"],
          ["cod", "Za pobraniem"],
          [
            "stripe",
            "Stripe: BLIK, Przelewy24, karta i Apple Pay (wymaga podpięcia konta)",
          ],
        ].map(([v, l]) => (
          <label className="check-label" key={v}>
            <input
              type="checkbox"
              name="paymentMethods"
              value={v}
              defaultChecked={value.paymentMethods.includes(
                v as StoreSettings["paymentMethods"][number],
              )}
            />
            {l}
          </label>
        ))}
        <label className="f">
          Rachunek do przelewów tradycyjnych
          <input
            name="bankAccount"
            defaultValue={value.bankAccount}
            maxLength={80}
          />
        </label>
        <p className="muted">
          Kluczy operatora płatności nie wpisuje się w tym formularzu.
        </p>
      </section>
      <section className="panel">
        <h3>Adresy kontaktowe</h3>
        <div className="field-grid">
          <label className="f">
            Powiadomienia o zamówieniach
            <input
              name="orderEmail"
              type="email"
              required
              defaultValue={value.orderEmail}
            />
          </label>
          <label className="f">
            Kontakt z firmą
            <input
              name="contactEmail"
              type="email"
              required
              defaultValue={value.contactEmail}
            />
          </label>
        </div>
      </section>
      <section className="panel">
        <h3>Gotowość do przyjmowania zamówień</h3>
        <p className="notice">
          Zaznacz zatwierdzenia dopiero po uzgodnieniu warunków. Puste
          ustawienia pozostawiają sklep bez aktywnego checkoutu.
        </p>
        <label className="f">
          Wersja zatwierdzonego regulaminu
          <input
            name="termsVersion"
            required
            maxLength={80}
            defaultValue={value.termsVersion}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            name="shippingApproved"
            defaultChecked={value.shippingApproved}
          />
          Cennik i warunki dostawy zostały zatwierdzone.
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            name="legalApproved"
            defaultChecked={value.legalApproved}
          />
          Regulamin i informacje dla kupujących zostały zatwierdzone.
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            name="checkoutEnabled"
            defaultChecked={value.checkoutEnabled}
          />
          Włącz przyjmowanie zamówień.
        </label>
      </section>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Zapisywanie…" : "Zapisz ustawienia"}
      </button>
    </form>
  );
}
