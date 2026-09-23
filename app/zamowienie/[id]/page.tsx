import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { accessibleOrder } from "@/lib/server/orders";
import { customerForSession } from "@/lib/server/auth";
import { storeSettings } from "@/lib/server/settings";
import { money } from "@/lib/store-types";
import { ClearPurchasedCart } from "./ClearPurchasedCart";
import { PaymentControls } from "./PaymentControls";
import { stripeCheckoutReady } from "@/lib/server/stripe-config";
import { query } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Twoje zamówienie — INNOCHEM",
  robots: { index: false, follow: false },
};
const statuses: Record<string, string> = {
  pending_payment: "Oczekuje na płatność",
  paid: "Opłacone",
  processing: "W przygotowaniu",
  shipped: "Wysłane",
  completed: "Zrealizowane",
  cancelled: "Anulowane",
  refunded: "Zwrócone",
  payment_review: "Płatność w wyjaśnieniu",
  legacy: "Zamówienie archiwalne",
};
export default async function Order({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await customerForSession(await headers());
  const token = (await cookies()).get(`innochem_order_${id}`)?.value;
  const data = await accessibleOrder(id, customer, token);
  if (!data) notFound();
  const { order, items } = data;
  const settings = await storeSettings();
  const payment =
    order.payment_method === "stripe"
      ? (
          await query("SELECT state FROM payment_sessions WHERE order_id=$1", [
            id,
          ])
        ).rows[0]
      : null;
  const legal = order.legal_version
    ? (
        await query("SELECT commerce FROM legal_versions WHERE version=$1", [
          order.legal_version,
        ])
      ).rows[0]
    : null;
  return (
    <main className="wrap order-page">
      <ClearPurchasedCart id={id} />
      <p className="label">Zamówienie INNOCHEM</p>
      <h1 className="display">
        Numer {order.legacy_id ? `archiwalny ${order.legacy_id}` : order.number}
      </h1>
      <p className="order-status">
        {order.status === "legacy"
          ? order.source_data?.statusName || statuses.legacy
          : statuses[order.status] || order.status}
      </p>
      <p>Data: {new Date(order.created_at).toLocaleDateString("pl-PL")}</p>
      {order.legal_version && (
        <p>
          <a href={`/api/orders/${id}/terms`}>
            Pobierz warunki zakupu zapisane przy tym zamówieniu
          </a>
        </p>
      )}
      <div className="panel">
        <h2>Produkty</h2>
        {items.map((i, index) => (
          <div className="order-line" key={index}>
            <span>
              {i.product_name} × {i.quantity}
            </span>
            <strong>{money(i.total_cents, order.currency)}</strong>
          </div>
        ))}
        <div className="order-line">
          <span>{order.shipping_label}</span>
          <strong>{money(order.shipping_cents, order.currency)}</strong>
        </div>
        <div className="order-line total">
          <span>Razem</span>
          <strong>{money(order.total_cents, order.currency)}</strong>
        </div>
      </div>
      {order.status === "pending_payment" &&
        order.payment_method === "bank_transfer" && (
          <div className="panel">
            <h2>Dane do przelewu</h2>
            <p>Odbiorca: INNOCHEM Aneta Zalewska</p>
            <p>
              Rachunek: {legal?.commerce.bankAccount || settings.bankAccount}
            </p>
            <p>Tytuł: INNOCHEM {order.number}</p>
            <p>Kwota: {money(order.total_cents, order.currency)}</p>
          </div>
        )}
      {order.status === "pending_payment" &&
        order.payment_method === "stripe" && (
          <PaymentControls
            id={id}
            state={payment?.state || null}
            available={stripeCheckoutReady()}
          />
        )}
      <p>
        <Link
          href={`/odstapienie?zamowienie=${encodeURIComponent(order.legacy_id ? `Archiwalne ${order.legacy_id}` : String(order.number))}`}
        >
          Odstąp od umowy
        </Link>
      </p>
      {order.tracking_number && <p>Numer przesyłki: {order.tracking_number}</p>}
      <p>
        Potrzebujesz pomocy? <Link href="/kontakt">Skontaktuj się z nami</Link>{" "}
        i podaj numer zamówienia.
      </p>
    </main>
  );
}
