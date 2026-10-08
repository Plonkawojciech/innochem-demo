"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { refundSummary } from "@/lib/server/refunds";
import { money } from "@/lib/store-types";
export function OrderActions({
  id,
  status,
  method,
  total,
  stockCommitted,
  trackingNumber,
  refunds,
  shippingCents,
}: {
  id: string;
  status: string;
  method: string;
  total: number;
  stockCommitted: boolean;
  trackingNumber?: string | null;
  refunds: ReturnType<typeof refundSummary>;
  shippingCents: number;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState("");
  const requestKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const remaining = total - refunds.refundedCents;
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
    ].includes(status) && remaining > 0
      ? [["record_refund", "Zapisz wykonany zwrot pieniędzy"]]
      : []),
    ...([
      "paid",
      "processing",
      "shipped",
      "completed",
      "refunded",
      "payment_review",
    ].includes(status) && stockCommitted
      ? [["record_return", "Przyjmij zwrócone sztuki do magazynu"]]
      : []),
  ];
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const selected = refunds.lines
        .map((i) => ({
          itemId: i.id,
          quantity: Number(f.get(`quantity:${i.id}`) || 0),
          amountCents: Math.round(Number(f.get(`refund:${i.id}`) || 0) * 100),
        }))
        .filter(
          (i) =>
            i.quantity > 0 || (action === "record_refund" && i.amountCents > 0),
        );
      const payload = {
        action,
        expectedStatus: status,
        reference: String(f.get("reference") || ""),
        trackingNumber: String(f.get("trackingNumber") || ""),
        note: String(f.get("note") || ""),
        ...(f.has("amount")
          ? { amountCents: Math.round(Number(f.get("amount")) * 100) }
          : {}),
        ...(action === "record_refund"
          ? {
              refundItems: selected,
              shippingRefundCents: Math.round(
                Number(f.get("shippingRefund") || 0) * 100,
              ),
            }
          : {}),
        ...(action === "record_return"
          ? {
              returnItems: selected.map(({ itemId, quantity }) => ({
                itemId,
                quantity,
              })),
            }
          : {}),
      };
      const fingerprint = JSON.stringify(payload);
      if (requestKey.current?.fingerprint !== fingerprint)
        requestKey.current = { fingerprint, key: crypto.randomUUID() };
      const r = await fetch(`/api/admin/orders/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          idempotencyKey: requestKey.current.key,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setAction("");
      requestKey.current = null;
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
      {refunds.refundedCents > 0 && (
        <p className="notice">
          Zapisano wykonane zwroty: {money(refunds.refundedCents)}. Pozostała
          kwota do rozliczenia: {money(remaining)}. Przyjęcie towaru do magazynu
          jest osobną operacją.
        </p>
      )}
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
                  defaultValue={
                    (action === "record_refund" ? remaining : total) / 100
                  }
                  max={action === "record_refund" ? remaining / 100 : undefined}
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
            <input
              name="trackingNumber"
              maxLength={180}
              defaultValue={trackingNumber || ""}
            />
          </label>
        )}
        {["record_refund", "record_return"].includes(action) && (
          <>
            {action === "record_return" && (
              <>
                <p className="notice">
                  Przyjmij tylko towar faktycznie otrzymany i nadający się do
                  sprzedaży. Ta operacja nie zapisuje zwrotu pieniędzy.
                </p>
                <label className="f">
                  Potwierdzenie przyjęcia
                  <input name="reference" required maxLength={180} />
                </label>
              </>
            )}
            {refunds.lines.map((i) => {
              const quantity =
                action === "record_return"
                  ? i.quantity - i.returnedQuantity
                  : i.quantity - i.refundedQuantity;
              if (
                quantity <= 0 &&
                (action === "record_return" || i.total_cents <= i.refundedCents)
              )
                return null;
              return (
                <fieldset key={`${action}:${i.id}`}>
                  <legend>{i.product_name}</legend>
                  <div className="field-grid">
                    <label className="f">
                      {action === "record_return"
                        ? "Sztuki przyjęte do magazynu"
                        : "Sztuki objęte refundacją (0 dla korekty kwoty)"}
                      <input
                        name={`quantity:${i.id}`}
                        type="number"
                        min={0}
                        max={quantity}
                        step={1}
                        required
                        defaultValue={action === "record_return" ? 0 : quantity}
                      />
                    </label>
                    {action === "record_refund" && (
                      <label className="f">
                        Zwrócona kwota pozycji (zł)
                        <input
                          name={`refund:${i.id}`}
                          type="number"
                          min={0}
                          max={(i.total_cents - i.refundedCents) / 100}
                          step="0.01"
                          required
                          defaultValue={(i.total_cents - i.refundedCents) / 100}
                        />
                      </label>
                    )}
                  </div>
                </fieldset>
              );
            })}
            {action === "record_refund" && (
              <label className="f">
                Zwrócony koszt dostawy (zł)
                <input
                  name="shippingRefund"
                  type="number"
                  min={0}
                  max={(shippingCents - refunds.shippingRefundedCents) / 100}
                  step="0.01"
                  required
                  defaultValue={
                    (shippingCents - refunds.shippingRefundedCents) / 100
                  }
                />
              </label>
            )}
            <label className="f">
              Uzasadnienie i sposób rozliczenia
              <textarea name="note" required maxLength={2000} />
            </label>
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
