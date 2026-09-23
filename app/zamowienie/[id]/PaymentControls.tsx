"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
export function PaymentControls({
  id,
  state,
  available,
}: {
  id: string;
  state: string | null;
  available: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const poll = async () => {
      try {
        if (document.visibilityState === "visible") {
          const r = await fetch(`/api/orders/${id}/payment/status`, {
            cache: "no-store",
          });
          if (r.ok) {
            const value = await r.json();
            if (
              !stopped &&
              (value.status !== "pending_payment" ||
                value.paymentState !== state)
            ) {
              router.refresh();
              return;
            }
          }
        }
      } catch {
        /* Retry transient connectivity errors within the bounded polling window. */
      }
      if (!stopped && ++attempts < 30) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, state, router]);
  async function act(refresh = false) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        `/api/orders/${id}/payment${refresh ? "/status" : ""}`,
        { method: "POST" },
      );
      const d = await r.json();
      if (!r.ok)
        throw new Error(d.error || "Nie udało się odczytać płatności.");
      if (!refresh && d.url) {
        window.location.assign(d.url);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Spróbuj ponownie za chwilę.");
    } finally {
      setBusy(false);
    }
  }
  const processing = state === "processing";
  return (
    <section className="panel">
      <h2>{processing ? "Płatność jest przetwarzana" : "Płatność online"}</h2>
      <p>
        {processing
          ? "Czekamy na potwierdzenie od operatora. Towar pozostaje zarezerwowany; nie opłacaj zamówienia ponownie."
          : "Wybierzesz metodę na bezpiecznej stronie płatności: BLIK, Przelewy24 lub karta. Apple Pay pojawi się na obsługiwanym urządzeniu z aktywnym portfelem."}
      </p>
      {!available && (
        <p className="notice">
          Płatności online są obecnie wyłączone. Możesz sprawdzić status
          rozpoczętej płatności.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        {!processing && available && (
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => act()}
          >
            {busy ? "Łączenie…" : "Przejdź do płatności"}
          </button>
        )}
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => act(true)}
        >
          Sprawdź status płatności
        </button>
      </div>
    </section>
  );
}
