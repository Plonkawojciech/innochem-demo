import { notFound } from "next/navigation";
import { z } from "zod";
import { adminPageUser } from "@/lib/server/admin-page";
import { adminOrder } from "@/lib/server/admin-orders";
import { money } from "@/lib/store-types";
import { orderLabels } from "@/lib/order-labels";
import { OrderActions } from "../../OrderActions";
import { ShipmentActions } from "../../ShipmentActions";
import {
  apaczkaConfigured,
  services,
  type ApaczkaService,
} from "@/lib/server/apaczka";
import { activeShipment, shipmentPending } from "@/lib/server/shipments";
import { storeSettings } from "@/lib/server/settings";
import { StoreError } from "@/lib/server/errors";
import { shippingKind } from "@/lib/shipping";
export default async function Order({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await adminPageUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await adminOrder(id);
  if (!data) notFound();
  const { order: o, items, events, payment, refunds } = data;
  const configured = apaczkaConfigured();
  const [settings, shipment, pending] = await Promise.all([
    storeSettings(),
    activeShipment(id),
    shipmentPending(id),
  ]);
  const shippingSnapshot = events.find((e) => e.kind === "created")?.data
    ?.shipping?.kind;
  const method = settings.shippingMethods.find(
    (m) => m.id === o.shipping_method,
  );
  const pickup =
    shippingKind({
      id: o.shipping_method,
      kind: shippingSnapshot || method?.kind,
    }) === "pickup";
  const blocked =
    !!o.legacy_id ||
    !["paid", "processing"].includes(o.status) ||
    !o.stock_committed ||
    pickup;
  let availableServices: ApaczkaService[] = [];
  let serviceError = "";
  if (configured && !shipment && !pending && !blocked) {
    try {
      availableServices = (await services()).filter(
        (s) => s.domestic === "1" && s.door_to_door === "1",
      );
    } catch (e) {
      serviceError =
        e instanceof StoreError
          ? e.message
          : "Nie udało się pobrać usług Apaczki.";
    }
  }
  return (
    <>
      <h2 className="display">
        Zamówienie {o.legacy_id ? `archiwalne ${o.legacy_id}` : o.number}
      </h2>
      <p>
        {new Date(o.created_at).toLocaleString("pl-PL")} ·{" "}
        {orderLabels[o.status]}
        {o.status === "legacy" && o.source_data?.statusName
          ? ` — ${o.source_data.statusName}`
          : ""}
      </p>
      <div className="admin-columns">
        <section className="panel">
          <h3>Pozycje</h3>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Produkt</th>
                  <th>Ilość</th>
                  <th>Razem</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.product_name}
                      <br />
                      {i.sku}
                    </td>
                    <td>{i.quantity}</td>
                    <td>{money(i.total_cents, o.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Dostawa: {o.shipping_label} — {money(o.shipping_cents, o.currency)}
          </p>
          <p>
            <b>Łącznie: {money(o.total_cents, o.currency)}</b>
          </p>
          <p>
            Płatność: {o.payment_method}. Potwierdzenie:{" "}
            {o.payment_reference || "brak"}.
          </p>
          {payment && (
            <p>
              Stripe:{" "}
              {
                (
                  {
                    creating: "tworzenie niepotwierdzone",
                    open: "oczekuje na opłacenie",
                    processing: "przetwarzanie płatności",
                    paid: "opłacone",
                    expired: "sesja wygasła",
                    failed: "niepowodzenie",
                    review: "do wyjaśnienia",
                  } as Record<string, string>
                )[payment.state]
              }
              . Tryb {payment.live_mode ? "rzeczywisty" : "testowy"}.<br />
              Sesja:{" "}
              {payment.provider_session_id || "brak potwierdzenia od operatora"}
              .<br />
              Ostatnia weryfikacja:{" "}
              {payment.last_checked_at
                ? new Date(payment.last_checked_at).toLocaleString("pl-PL")
                : "oczekuje"}
              .
            </p>
          )}
          {o.tracking_number && <p>Przesyłka: {o.tracking_number}</p>}
        </section>
        <section className="panel">
          <h3>Klient i dostawa</h3>
          <p>
            {o.buyer.firstName} {o.buyer.lastName}
            <br />
            {o.email}
            <br />
            {o.buyer.phone}
            <br />
            {o.buyer.company} {o.buyer.nip}
          </p>
          <address>
            {o.shipping_address.street}
            <br />
            {o.shipping_address.postalCode} {o.shipping_address.city}
            <br />
            {o.shipping_address.country}
          </address>
        </section>
      </div>
      {!o.legacy_id && (
        <OrderActions
          key={`${o.status}:${refunds.refundedCents}:${refunds.lines.reduce((sum, i) => sum + i.returnedQuantity, 0)}`}
          id={id}
          status={o.status}
          method={o.payment_method}
          total={o.total_cents}
          stockCommitted={o.stock_committed}
          trackingNumber={o.tracking_number}
          refunds={refunds}
          shippingCents={o.shipping_cents}
        />
      )}
      <ShipmentActions
        key={`${shipment?.id || "none"}:${shipment?.waybill_number || ""}:${pending}`}
        id={id}
        configured={configured}
        services={availableServices}
        presets={settings.parcelPresets}
        shipment={shipment}
        pending={pending}
        blocked={blocked}
        serviceError={serviceError}
        pickup={pickup}
      />
      <section className="panel">
        <h3>Historia zmian</h3>
        <ol className="event-list">
          {events.map((e, i) => (
            <li key={i}>
              <time>{new Date(e.created_at).toLocaleString("pl-PL")}</time>
              <b>
                {e.data?.statusName ||
                  (
                    {
                      shipment_cancel_pending:
                        "Anulowanie przesyłki oczekuje na potwierdzenie",
                      shipment_cancel_rejected:
                        "Odrzucono anulowanie przesyłki",
                      shipment_pending:
                        "Nadanie w Apaczce oczekuje na potwierdzenie",
                      shipment_created: "Nadano przesyłkę przez Apaczkę",
                      shipment_cancelled: "Anulowano przesyłkę w Apaczce",
                      shipment_rejected: "Nie przyjęto zlecenia przesyłki",
                      shipment_quoted: "Pobrano wycenę przesyłki",
                      created: "Utworzono zamówienie",
                      paid: "Potwierdzono płatność",
                      ship: "Wysłano",
                      process: "Rozpoczęto realizację",
                      complete: "Zakończono",
                      cancelled: "Anulowano",
                      reservation_expired: "Rezerwacja wygasła",
                      record_refund: "Zapisano rozliczenie zwrotu",
                      record_return: "Przyjęto zwrócony towar do magazynu",
                      late_payment: "Płatność po anulowaniu",
                      cancel_cod: "Anulowano pobranie",
                    } as Record<string, string>
                  )[e.kind] ||
                  e.kind}
              </b>
              {e.data?.note && <p>{e.data.note}</p>}
              {e.data?.reference && <p>Potwierdzenie: {e.data.reference}</p>}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
