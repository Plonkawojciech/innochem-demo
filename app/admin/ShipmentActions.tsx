"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ApaczkaService } from "@/lib/server/apaczka";
import type { StoreSettings } from "@/lib/server/settings";
import type { Shipment } from "@/lib/server/shipments";
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
}: {
  id: string;
  configured: boolean;
  services: ApaczkaService[];
  presets: StoreSettings["parcelPresets"];
  shipment: Shipment | null;
  pending: boolean;
  blocked: boolean;
  serviceError: string;
}) {
  const router = useRouter();
  const [serviceId, setServiceId] = useState("");
  const [presetId, setPresetId] = useState(presets[0]?.id || "");
  const [parcel, setParcel] = useState<Parcel>(
    presets[0] || { lengthCm: 30, widthCm: 20, heightCm: 25, weightKg: 5 },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pickupDate, setPickupDate] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [current, setCurrent] = useState(shipment);
  const service = services.find((s) => s.service_id === serviceId);
  async function mutate(method: "POST" | "DELETE") {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/admin/orders/${id}/shipment`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(method === "POST"
          ? {
              body: JSON.stringify({
                serviceId,
                parcel: Object.fromEntries(
                  parcelFields.map(([key]) => [key, parcel[key]]),
                ),
                ...(pickupDate ? { pickupDate } : {}),
              }),
            }
          : {}),
      });
      const data = await r.json();
      if (!r.ok) {
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
            <p>Dla tego zamówienia nadanie nie jest dostępne.</p>
          ) : (
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void mutate("POST");
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
              <label className="f">
                Preset paczki
                <select
                  value={presetId}
                  onChange={(e) => {
                    setPresetId(e.target.value);
                    const p = presets.find((p) => p.id === e.target.value);
                    if (p) setParcel(p);
                  }}
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                „Karton 4 butelki”, 30 × 20 × 25 cm i 5 kg to przykład do
                zmiany. Wpisz rzeczywiste wymiary i wagę zapakowanej przesyłki.
              </p>
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
                      value={parcel[key]}
                      onChange={(e) =>
                        setParcel((p) => ({
                          ...p,
                          [key]: Number(e.target.value),
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
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
              <label className="check-label">
                <input type="checkbox" required />
                Potwierdzam usługę, dane odbiorcy i parametry paczki.
              </label>
              <button className="btn btn-primary" disabled={busy || !serviceId}>
                {busy ? "Nadawanie…" : "Nadaj przez Apaczkę"}
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
