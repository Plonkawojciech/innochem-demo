"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
type Fields = {
  name: string;
  email: string;
  purchaseReference: string;
  scope: string;
};
export function WithdrawalForm({
  preview,
  reference = "",
}: {
  preview: boolean;
  reference?: string;
}) {
  const [fields, setFields] = useState<Fields>({
      name: "",
      email: "",
      purchaseReference: reference,
      scope: "Całe zamówienie",
    }),
    [step, setStep] = useState<"edit" | "confirm">("edit"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState<{
      id: string;
      reference: string;
      receipt: string;
    } | null>(null);
  const key = useRef<string | null>(null);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    key.current ??= crypto.randomUUID();
    try {
      const r = await fetch("/api/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...fields,
          idempotencyKey: key.current,
          confirmed: true,
        }),
      });
      const d = await r.json();
      if (!r.ok)
        throw new Error(d.error || "Nie udało się zapisać oświadczenia.");
      setReceipt(d);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Nie udało się połączyć ze sklepem.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (receipt)
    return (
      <section className="panel" role="status">
        <h2>
          {preview ? "Test oświadczenia zapisany" : "Otrzymaliśmy oświadczenie"}
        </h2>
        <p>Numer OD-{receipt.reference}. Zachowaj poniższe potwierdzenie.</p>
        {preview ? (
          <p>
            W podglądzie nie wysyłamy wiadomości ani nie przekazujemy oświadczeń
            do działającego sklepu.
          </p>
        ) : (
          <p>Potwierdzenie przekażemy również na podany adres e-mail.</p>
        )}
        <p>
          <a
            className="btn btn-primary"
            href={`/api/withdrawals/${receipt.id}/receipt`}
          >
            Pobierz potwierdzenie
          </a>
        </p>
        <pre className="withdrawal-receipt">{receipt.receipt}</pre>
      </section>
    );
  if (step === "confirm")
    return (
      <form className="panel" onSubmit={send}>
        <h2>Sprawdź oświadczenie</h2>
        <p>Oświadczam, że odstępuję od umowy sprzedaży.</p>
        <dl>
          <dt>Imię i nazwisko</dt>
          <dd>{fields.name}</dd>
          <dt>Potwierdzenie e-mail</dt>
          <dd>{fields.email}</dd>
          <dt>Zamówienie lub opis zakupu</dt>
          <dd>{fields.purchaseReference}</dd>
          <dt>Zakres odstąpienia</dt>
          <dd className="pre-line">{fields.scope}</dd>
        </dl>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            className="btn btn-outline"
            type="button"
            disabled={busy}
            onClick={() => setStep("edit")}
          >
            Popraw dane
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Zapisywanie…" : "Potwierdź odstąpienie"}
          </button>
        </div>
      </form>
    );
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        setStep("confirm");
        setError("");
      }}
    >
      <div className="f-grid">
        {[
          { key: "name", label: "Imię i nazwisko", max: 120, auto: "name" },
          {
            key: "email",
            label: "E-mail do potwierdzenia",
            max: 254,
            auto: "email",
          },
          {
            key: "purchaseReference",
            label: "Numer zamówienia lub opis zakupu",
            max: 180,
            auto: "off",
          },
        ].map((f) => (
          <label className="f" key={f.key}>
            {f.label}
            <input
              required
              type={f.key === "email" ? "email" : "text"}
              minLength={f.key === "name" ? 2 : 1}
              maxLength={f.max}
              autoComplete={f.auto}
              value={fields[f.key as keyof Fields]}
              onChange={(e) =>
                setFields({ ...fields, [f.key]: e.target.value })
              }
            />
          </label>
        ))}
      </div>
      <label className="f">
        Zakres odstąpienia
        <textarea
          required
          maxLength={3000}
          rows={4}
          value={fields.scope}
          onChange={(e) => setFields({ ...fields, scope: e.target.value })}
        />
        <small>
          Możesz wskazać całe zamówienie albo wybrane produkty i ich liczbę. Nie
          musisz podawać przyczyny.
        </small>
      </label>
      <p>
        Dane wykorzystamy do przyjęcia oświadczenia i obsługi zwrotu.{" "}
        <Link href="/polityka-prywatnosci">Polityka prywatności</Link>.
      </p>
      <button className="btn btn-primary">Sprawdź oświadczenie</button>
    </form>
  );
}
