"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
export function OrderActions({
  id,
  status,
  method,
  total,
  stockCommitted,
}: {
  id: string;
  status: string;
  method: string;
  total: number;
  stockCommitted: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState("");
  const choices = [
    ...(status === "pending_payment"
      ? [
          ...(method === "bank_transfer"
            ? [["confirm_bank", "Potwierdź zaksięgowany przelew"]]
            : []),
          ["cancel_pending", "Anuluj nieopłacone zamówienie"],
          ...(method === "stripe"
            ? [["refresh_payment", "Sprawdź płatność w Stripe"]]
            : []),
        ]
      : []),
    ...(status === "paid" ? [["process", "Rozpocznij realizację"]] : []),
    ...(["paid", "processing"].includes(status)
      ? [["ship", "Oznacz jako wysłane"]]
      : []),
    ...(status === "shipped" ? [["complete", "Zakończ zamówienie"]] : []),
    ...(status === "processing" && method === "cod"
      ? [["cancel_cod", "Anuluj niewysłane pobranie i przywróć stan"]]
      : []),
    ...([
      "paid",
      "processing",
      "shipped",
      "completed",
      "payment_review",
    ].includes(status)
      ? [["record_refund", "Zapisz wykonany zwrot pieniędzy"]]
      : []),
  ];
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch(`/api/admin/orders/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          expectedStatus: status,
          idempotencyKey: crypto.randomUUID(),
          reference: String(f.get("reference") || ""),
          trackingNumber: String(f.get("trackingNumber") || ""),
          note: String(f.get("note") || ""),
          ...(f.has("amount")
            ? { amountCents: Math.round(Number(f.get("amount")) * 100) }
            : {}),
          restock: f.get("restock") === "on",
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setAction("");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Nie udało się zapisać operacji.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!choices.length) return null;
  return (
    <section className="panel">
      <h3>Obsługa zamówienia</h3>
      <form onSubmit={submit}>
        <label className="f">
          Operacja
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            required
          >
            <option value="">Wybierz operację</option>
            {choices.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {["confirm_bank", "record_refund"].includes(action) && (
          <>
            <p className="notice">
              {action === "record_refund"
                ? "Zapisz dopiero po faktycznym wykonaniu zwrotu poza panelem. Przycisk nie wysyła pieniędzy."
                : "Potwierdź dopiero po sprawdzeniu wpływu na rachunek."}
            </p>
            <div className="field-grid">
              <label className="f">
                Kwota potwierdzona (zł)
                <input
                  name="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={total / 100}
                />
              </label>
              <label className="f">
                Numer potwierdzenia
                <input name="reference" required maxLength={180} />
              </label>
            </div>
          </>
        )}
        {action === "refresh_payment" && (
          <label className="f">
            Identyfikator sesji Stripe (opcjonalnie)
            <input name="reference" maxLength={180} placeholder="cs_…" />
            <small>
              Zostaw puste, aby sprawdzić przypisaną sesję. Jeśli połączenie
              przerwało się przy jej tworzeniu, skopiuj identyfikator sesji tego
              zamówienia ze Stripe. Kwota i powiązanie zostaną sprawdzone
              automatycznie.
            </small>
          </label>
        )}
        {action === "ship" && (
          <label className="f">
            Numer przesyłki
            <input name="trackingNumber" maxLength={180} />
          </label>
        )}
        {action === "record_refund" && (
          <>
            <label className="f">
              Uzasadnienie i sposób zwrotu
              <textarea name="note" required maxLength={2000} />
            </label>
            {stockCommitted && (
              <label className="check-label">
                <input name="restock" type="checkbox" />
                Towar wrócił w całości i nadaje się do sprzedaży — przyjmij go
                do magazynu.
              </label>
            )}
          </>
        )}
        {action && (
          <label className="check-label">
            <input type="checkbox" required />
            Potwierdzam wybraną operację.
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy || !action}>
          {busy ? "Zapisywanie…" : "Zapisz operację"}
        </button>
      </form>
    </section>
  );
}
