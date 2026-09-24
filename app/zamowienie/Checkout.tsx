"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useCart } from "@/lib/cart";
import { mediaSrc } from "@/lib/media";
import { money, type StoreProduct } from "@/lib/store-types";
type Delivery = { id: string; label: string; priceCents: number; cod: boolean };
type Payment = "bank_transfer" | "cod" | "stripe";
export function Checkout({
  shipping,
  payments,
  termsVersion,
  enabled,
  account,
}: {
  shipping: Delivery[];
  payments: Payment[];
  termsVersion: string;
  enabled: boolean;
  account: {
    firstName: string;
    lastName: string;
    email: string;
    addresses: { id: string; label: string; data: Record<string, string> }[];
  } | null;
}) {
  const { cart, setQuantity, ready } = useCart();
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const cartIds = Object.keys(cart).sort().join(",");
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setCatalogReady(false);
    setCatalogError("");
    if (!cartIds) {
      setProducts([]);
      setCatalogReady(true);
      return;
    }
    fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: cartIds.split(",") }),
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok)
          throw new Error("Nie udało się odświeżyć cen i dostępności koszyka.");
        const data = await r.json();
        if (!controller.signal.aborted) {
          setProducts(data.products);
          setCatalogReady(true);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setCatalogError(
            e instanceof Error ? e.message : "Nie udało się wczytać koszyka.",
          );
      });
    return () => controller.abort();
  }, [ready, cartIds]);
  const [shippingId, setShippingId] = useState(shipping[0]?.id || "");
  const [payment, setPayment] = useState<Payment>(
    payments[0] || "bank_transfer",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({
    firstName: account?.firstName || "",
    lastName: account?.lastName || "",
    email: account?.email || "",
  });
  const key = useRef<string | null>(null);
  const delivery = shipping.find((s) => s.id === shippingId);
  const items = Object.entries(cart).map(([id, quantity]) => ({
    id,
    quantity,
    product: products.find((p) => p.id === id),
  }));
  const unavailable = items.some(
    (x) =>
      !x.product ||
      x.quantity > x.product.available ||
      x.product.saleMode !== "retail",
  );
  const subtotal = items.reduce(
    (sum, i) => sum + (i.product?.priceCents || 0) * i.quantity,
    0,
  );
  const total = subtotal + (delivery?.priceCents || 0);
  const allowedPayments = payments.filter((p) => p !== "cod" || delivery?.cod);
  useEffect(() => {
    if (!allowedPayments.includes(payment))
      setPayment(allowedPayments[0] || "bank_transfer");
  }, [shippingId, payment, allowedPayments.join(",")]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) || "");
    key.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: key.current,
          lines: items.map((i) => ({ productId: i.id, quantity: i.quantity })),
          buyer: {
            firstName: field("firstName"),
            lastName: field("lastName"),
            email: field("email"),
            phone: field("phone"),
            company: field("company"),
            nip: field("nip"),
          },
          address: {
            street: field("street"),
            postalCode: field("postalCode"),
            city: field("city"),
            country: "PL",
          },
          shippingMethod: shippingId,
          paymentMethod: payment,
          expectedTotalCents: total,
          termsAccepted: data.get("terms") === "on",
          termsVersion,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === "IDEMPOTENCY_CONFLICT") key.current = null;
        throw new Error(result.error || "Nie udało się zapisać zamówienia.");
      }
      sessionStorage.setItem("innochem-last-order", result.id);
      window.location.assign(result.url);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Nie udało się połączyć ze sklepem.",
      );
      setBusy(false);
    }
  }
  if (catalogError)
    return (
      <main className="wrap order-page">
        <p className="form-error" role="alert">
          {catalogError}
        </p>
        <button
          className="btn btn-primary"
          onClick={() => window.location.reload()}
        >
          Spróbuj ponownie
        </button>
      </main>
    );
  if (!ready || !catalogReady)
    return <p className="wrap loading-message">Wczytywanie koszyka…</p>;
  if (!items.length)
    return (
      <main className="wrap">
        <div className="empty-state">
          <h1 className="display">Twój koszyk jest pusty</h1>
          <p>Wybierz produkty z katalogu, aby złożyć zamówienie.</p>
          <Link href="/katalog">Przejdź do produktów</Link>
        </div>
      </main>
    );
  return (
    <main className="wrap checkout-page">
      <p className="crumbs">
        <Link href="/katalog">Produkty</Link> / Koszyk i zamówienie
      </p>
      <h1 className="display">Twoje zamówienie</h1>
      {!enabled && (
        <p className="notice" role="status">
          Podgląd sklepu. Składanie zamówień będzie dostępne po zatwierdzeniu
          warunków sprzedaży.
        </p>
      )}
      <form onSubmit={submit}>
        <div className="chk">
          <div>
            <section className="panel">
              <h2 className="display">Koszyk</h2>
              {items.map(({ id, quantity, product: p }) => (
                <div className="cart-item" key={id}>
                  {p?.imagePath && (
                    <img
                      src={mediaSrc(p.imagePath, 160)}
                      alt=""
                      width={64}
                      height={64}
                      loading="lazy"
                    />
                  )}
                  <div>
                    <b>{p?.name || "Produkt niedostępny"}</b>
                    {p && <span>{money(p.priceCents)} / szt.</span>}
                    <label>
                      Ilość{" "}
                      <input
                        className="cart-quantity"
                        type="number"
                        min={1}
                        max={999}
                        value={quantity}
                        aria-label={`Ilość: ${p?.name || "produkt"}`}
                        onChange={(e) =>
                          setQuantity(
                            id,
                            Math.max(1, Number(e.target.value) || 1),
                          )
                        }
                      />
                    </label>
                    {p && quantity > p.available && (
                      <small className="form-error">
                        Dostępne: {p.available} szt.
                      </small>
                    )}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setQuantity(id, 0)}
                    >
                      Usuń
                    </button>
                  </div>
                  <strong>{money((p?.priceCents || 0) * quantity)}</strong>
                </div>
              ))}
            </section>
            <section className="panel">
              <h2 className="display">Dane zamawiającego</h2>
              {account ? (
                <p>
                  Zalogowano jako {account.email}.{" "}
                  <Link href="/konto">Moje konto</Link>
                </p>
              ) : (
                <p>
                  <Link href="/konto">Zaloguj się</Link> lub zamów bez konta.
                </p>
              )}
              {!!account?.addresses.length && (
                <label className="f">
                  Użyj zapisanego adresu
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const selected = account.addresses.find(
                        (a) => a.id === e.target.value,
                      );
                      if (selected)
                        setFields((f) => ({
                          ...f,
                          ...selected.data,
                          email: account.email,
                          street: [selected.data.street, selected.data.street2]
                            .filter(Boolean)
                            .join(", "),
                        }));
                    }}
                  >
                    <option value="">Wybierz adres</option>
                    {account.addresses.map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.label} — {a.data.street}, {a.data.city}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="f-grid">
                {[
                  { name: "firstName", label: "Imię", auto: "given-name" },
                  { name: "lastName", label: "Nazwisko", auto: "family-name" },
                  {
                    name: "email",
                    label: "E-mail",
                    auto: "email",
                    type: "email",
                  },
                  { name: "phone", label: "Telefon", auto: "tel", type: "tel" },
                  {
                    name: "company",
                    label: "Firma (opcjonalnie)",
                    auto: "organization",
                    optional: true,
                  },
                  {
                    name: "nip",
                    label: "NIP (opcjonalnie)",
                    auto: "off",
                    optional: true,
                  },
                  {
                    name: "street",
                    label: "Ulica i numer",
                    auto: "street-address",
                  },
                  {
                    name: "postalCode",
                    label: "Kod pocztowy",
                    auto: "postal-code",
                    pattern: "[0-9]{2}-[0-9]{3}",
                  },
                  { name: "city", label: "Miasto", auto: "address-level2" },
                ].map((f) => (
                  <label className="f" key={f.name}>
                    {f.label}
                    <input
                      name={f.name}
                      autoComplete={f.auto}
                      type={f.type || "text"}
                      required={!f.optional}
                      maxLength={f.name === "email" ? 254 : 180}
                      pattern={f.pattern}
                      value={fields[f.name] || ""}
                      onChange={(e) =>
                        setFields((v) => ({ ...v, [f.name]: e.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
            </section>
            <section className="panel">
              <h2 className="display">Dostawa i płatność</h2>
              <fieldset className="checkout-options">
                <legend>Sposób dostawy</legend>
                {shipping.map((s) => (
                  <label className="opt" key={s.id}>
                    <input
                      type="radio"
                      name="shipping"
                      value={s.id}
                      checked={shippingId === s.id}
                      onChange={() => setShippingId(s.id)}
                    />
                    <span>{s.label}</span>
                    <strong>{money(s.priceCents)}</strong>
                  </label>
                ))}
                {!shipping.length && (
                  <p>Metody dostawy oczekują na zatwierdzenie.</p>
                )}
              </fieldset>
              <fieldset className="checkout-options">
                <legend>Płatność</legend>
                {allowedPayments.map((p) => (
                  <label className="opt" key={p}>
                    <input
                      type="radio"
                      name="payment"
                      checked={payment === p}
                      onChange={() => setPayment(p)}
                    />
                    <span>
                      {p === "bank_transfer"
                        ? "Przelew tradycyjny"
                        : p === "cod"
                          ? "Płatność przy odbiorze"
                          : "Płatność online: BLIK, Przelewy24 lub karta"}
                    </span>
                  </label>
                ))}
                {!allowedPayments.length && (
                  <p>Metody płatności oczekują na zatwierdzenie.</p>
                )}
              </fieldset>
            </section>
          </div>
          <aside className="panel order-summary">
            <h2 className="display">Podsumowanie</h2>
            <dl>
              <div>
                <dt>Produkty</dt>
                <dd>{money(subtotal)}</dd>
              </div>
              <div>
                <dt>Dostawa</dt>
                <dd>
                  {delivery ? money(delivery.priceCents) : "Do ustalenia"}
                </dd>
              </div>
              <div className="total">
                <dt>Razem brutto</dt>
                <dd>
                  {delivery ? money(total) : money(subtotal) + " + dostawa"}
                </dd>
              </div>
            </dl>
            <label className="check-label">
              <input type="checkbox" name="terms" required />{" "}
              <span>
                Akceptuję{" "}
                <Link href="/regulamin" target="_blank">
                  regulamin
                </Link>{" "}
                i potwierdzam zapoznanie się z{" "}
                <Link href="/polityka-prywatnosci" target="_blank">
                  polityką prywatności
                </Link>
                .
              </span>
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button
              className="btn btn-primary"
              disabled={
                !enabled ||
                busy ||
                unavailable ||
                !delivery ||
                !allowedPayments.length
              }
            >
              {busy ? "Zapisywanie…" : "Zamawiam z obowiązkiem zapłaty"}
            </button>
            <p className="small-note">
              Po zapisaniu otrzymasz numer zamówienia i dalsze informacje o
              płatności.
            </p>
          </aside>
        </div>
      </form>
    </main>
  );
}
