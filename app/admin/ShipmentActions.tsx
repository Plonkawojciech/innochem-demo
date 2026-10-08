"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ApaczkaService } from "@/lib/server/apaczka";
import type { StoreSettings } from "@/lib/server/settings";
import type { Shipment } from "@/lib/server/shipments";
import { money } from "@/lib/store-types";
import { parcelFields, type Parcel } from "@/lib/parcel";
export function ShipmentActions({
  id,
  configured,
  services,
  presets,
  shipment,
  pending,
  blocked,
  serviceError,
  pickup,
}: {
  id: string;
  configured: boolean;
  services: ApaczkaService[];
  presets: StoreSettings["parcelPresets"];
  shipment: Shipment | null;
  pending: boolean;
  blocked: boolean;
  serviceError: string;
  pickup: boolean;
}) {
  const router = useRouter();
  const [serviceId, setServiceId] = useState("");
  const blankParcel: Parcel = {
    lengthCm: 0,
    widthCm: 0,
    heightCm: 0,
    weightKg: 0,
  };
  const [parcels, setParcels] = useState<Parcel[]>([blankParcel]);
  const [quote, setQuote] = useState<{
    quoteId: string;
    grossCents: number;
    netCents: number;
    expiresAt: string;
    mode: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pickupDate, setPickupDate] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [current, setCurrent] = useState(shipment);
  const service = services.find((s) => s.service_id === serviceId);
  useEffect(() => {
    setQuote(null);
  }, [parcels, serviceId, pickupDate]);
  const payload = () => ({
    serviceId,
    parcels: parcels.map((parcel) =>
      Object.fromEntries(parcelFields.map(([key]) => [key, parcel[key]])),
    ),
    ...(pickupDate ? { pickupDate } : {}),
  });
  async function estimate() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/admin/orders/${id}/shipment/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setQuote(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się pobrać wyceny.");
    } finally {
      setBusy(false);
    }
  }
  async function mutate(method: "POST" | "DELETE") {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/admin/orders/${id}/shipment`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(method === "POST"
          ? {
              body: JSON.stringify({ ...payload(), quoteId: quote?.quoteId }),
            }
          : {}),
      });
      const data = await r.json();
      if (!r.ok) {
        if (
          ["SHIPMENT_QUOTE_REQUIRED", "SHIPMENT_QUOTE_CHANGED"].includes(
            data.code,
          )
        )
          setQuote(null);
        if (
          [
            "APACZKA_UNCERTAIN",
            "SHIPMENT_SAVE_UNCERTAIN",
            "SHIPMENT_PENDING",
          ].includes(data.code)
        )
          setUncertain(true);
        throw new Error(data.error);
      }
      setCurrent(method === "POST" ? data : null);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Nie udało się potwierdzić operacji. Odśwież widok przed kolejną próbą.",
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function label() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/admin/orders/${id}/shipment/label`);
      if (!r.ok) throw new Error((await r.json()).error);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `etykieta-${id}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Nie udało się pobrać etykiety.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h3>Przesyłka</h3>
      {!configured ? (
        <p>Integracja Apaczka nie jest skonfigurowana</p>
      ) : (
        <>
          {current ? (
            <>
              <p>
                {current.service_name}. Numer listu:{" "}
                {current.waybill_number ||
                  "oczekuje na przydzielenie przez przewoźnika"}
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={label}
              >
                Pobierz etykietę
              </button>{" "}
              <button
                type="button"
                className="btn btn-outline"
                disabled={busy || uncertain || pending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Anulować tę przesyłkę w Apaczce? Zamówienie pozostanie bez zmian.",
                    )
                  )
                    void mutate("DELETE");
                }}
              >
                Anuluj przesyłkę
              </button>
            </>
          ) : pending || uncertain ? (
            <p className="notice">
              Nadanie oczekuje na wyjaśnienie. Sprawdź panel Apaczki i
              skontaktuj się z administratorem technicznym przed kolejną próbą.
            </p>
          ) : blocked ? (
            <p>
              {pickup
                ? "Odbiór osobisty w Kielcach po uzgodnieniu terminu — nie zamawiaj kuriera."
                : "Nadanie wymaga opłaconego lub realizowanego zamówienia z zatwierdzonym stanem magazynu."}
            </p>
          ) : (
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (quote) void mutate("POST");
                else void estimate();
              }}
            >
              {serviceError && (
                <p className="form-error" role="alert">
                  {serviceError}
                </p>
              )}
              <label className="f">
                Usługa
                <select
                  required
                  value={serviceId}
                  onChange={(e) => {
                    setServiceId(e.target.value);
                    setPickupDate("");
                  }}
                >
                  <option value="">Wybierz usługę</option>
                  {services.map((s) => (
                    <option value={s.service_id} key={s.service_id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                Wpisz rzeczywiste zewnętrzne wymiary i wagę każdej zapakowanej
                paczki. Zapisane szablony są pomocą; obsługa potwierdza ich
                zgodność z aktualnym opakowaniem.
              </p>
              {parcels.map((parcel, index) => (
                <fieldset key={index} disabled={busy}>
                  <legend>Paczka {index + 1}</legend>
                  <label className="f">
                    Szablon opakowania
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const preset = presets.find(
                          (p) => p.id === e.target.value,
                        );
                        if (preset)
                          setParcels((old) =>
                            old.map((p, i) =>
                              i === index ? { ...preset } : p,
                            ),
                          );
                      }}
                    >
                      <option value="">Własne wymiary</option>
                      {presets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="field-grid">
                    {parcelFields.map(([key, label]) => (
                      <label className="f" key={key}>
                        {label}
                        <input
                          type="number"
                          required
                          min={key === "weightKg" ? 0.1 : 1}
                          max={key === "weightKg" ? 100 : 300}
                          step={key === "weightKg" ? 0.1 : 1}
                          value={parcel[key] || ""}
                          onChange={(e) =>
                            setParcels((old) =>
                              old.map((p, i) =>
                                i === index
                                  ? { ...p, [key]: Number(e.target.value) }
                                  : p,
                              ),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                  {parcels.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() =>
                        setParcels((old) => old.filter((_, i) => i !== index))
                      }
                    >
                      Usuń paczkę {index + 1}
                    </button>
                  )}
                </fieldset>
              ))}
              <button
                type="button"
                className="btn btn-outline"
                disabled={busy || parcels.length >= 20}
                onClick={() =>
                  setParcels((old) => [...old, { ...blankParcel }])
                }
              >
                Dodaj kolejną paczkę
              </button>
              {service && service.pickup_courier !== "0" && (
                <label className="f">
                  Data odbioru przez kuriera{" "}
                  {service.pickup_courier === "2"
                    ? "(wymagana)"
                    : "(opcjonalna)"}
                  <input
                    type="date"
                    required={service.pickup_courier === "2"}
                    value={pickupDate}
                    onChange={(e) => setPickupDate(e.target.value)}
                  />
                </label>
              )}
              <p className="muted">
                Bez daty: samodzielne nadanie. Z datą: odbiór przez kuriera w
                godzinach dostępnych w Apaczce. Nadanie może obciążyć konto
                Apaczki według umowy.
              </p>
              {quote && (
                <>
                  <p className="notice">
                    Wycena Apaczki: <b>{money(quote.grossCents)} brutto</b> (
                    {money(quote.netCents)} netto), liczba paczek:{" "}
                    {parcels.length}.
                    {quote.mode === "sandbox"
                      ? " Środowisko testowe."
                      : " Nadanie obciąży konto Apaczki."}{" "}
                    Wycena ważna do{" "}
                    {new Date(quote.expiresAt).toLocaleTimeString("pl-PL")}.
                    Końcowe rozliczenie i ewentualne dopłaty określa umowa z
                    przewoźnikiem.
                  </p>
                  <label className="check-label">
                    <input type="checkbox" required />
                    Potwierdzam wycenę, usługę, dane odbiorcy i parametry
                    wszystkich paczek.
                  </label>
                </>
              )}
              <button className="btn btn-primary" disabled={busy || !serviceId}>
                {busy
                  ? "Przetwarzanie…"
                  : quote
                    ? "Nadaj przez Apaczkę"
                    : "Sprawdź koszt nadania"}
              </button>
            </form>
          )}
        </>
      )}
      {pending && current && (
        <p className="notice">
          Anulowanie oczekuje na wyjaśnienie. Sprawdź stan zlecenia w Apaczce.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
