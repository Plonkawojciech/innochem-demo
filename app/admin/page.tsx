import Link from "next/link";
import { adminPageUser } from "@/lib/server/admin-page";
import { query } from "@/lib/server/db";
export default async function Dashboard() {
  await adminPageUser();
  const {
    rows: [s],
  } = await query(
    `SELECT (SELECT count(*) FROM products WHERE status='active') AS products,(SELECT count(*) FROM orders WHERE status IN ('paid','processing') AND legacy_id IS NULL) AS orders,(SELECT count(*) FROM inquiries WHERE status='new') AS inquiries,(SELECT count(*) FROM products WHERE status='active' AND stock-reserved<=0) AS empty,(SELECT count(*) FROM orders WHERE status='payment_review') AS review,(SELECT count(*) FROM mail_outbox WHERE sent_at IS NULL AND NOT preview) AS mail,(SELECT count(*) FROM withdrawals WHERE status='received' AND NOT preview) AS withdrawals`,
  );
  const waitingPayments = (
    await query(
      "SELECT o.id,o.number,ps.state FROM payment_sessions ps JOIN orders o ON o.id=ps.order_id WHERE o.status='pending_payment' AND ((ps.state='creating' AND ps.created_at<now()-interval '2 minutes') OR (ps.state IN ('open','processing') AND (ps.last_checked_at<now()-interval '10 minutes' OR ps.created_at<now()-interval '1 day'))) ORDER BY ps.created_at LIMIT 20",
    )
  ).rows;
  return (
    <>
      <section className="admin-stats">
        {[
          ["Produkty aktywne", s.products, "produkty"],
          ["Zamówienia do realizacji", s.orders, "zamowienia"],
          ["Nowe zapytania", s.inquiries, "zapytania"],
          ["Produkty niedostępne", s.empty, "produkty"],
        ].map(([label, value, href]) => (
          <Link href={`/admin/${href}`} className="panel" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </Link>
        ))}
      </section>
      <section className="panel">
        <h2 className="display">Do sprawdzenia</h2>
        <p>
          Nowe oświadczenia o odstąpieniu:{" "}
          <Link href="/admin/odstapienia">
            <b>{s.withdrawals}</b>
          </Link>
          .
        </p>
        <p>
          Płatności wymagające ręcznego rozliczenia: <b>{s.review}</b>.
        </p>
        {waitingPayments.length > 0 && (
          <>
            <h3>Płatności do sprawdzenia u operatora</h3>
            <p>
              Rezerwacja pozostaje aktywna do potwierdzenia wyniku. Sprawdź
              płatność w szczegółach zamówienia.
            </p>
            <ul>
              {waitingPayments.map((p) => (
                <li key={p.id}>
                  <Link href={`/admin/zamowienia/${p.id}`}>
                    Zamówienie {p.number}
                  </Link>{" "}
                  —{" "}
                  {p.state === "creating"
                    ? "przerwane tworzenie płatności"
                    : "oczekuje na aktualny status"}
                </li>
              ))}
            </ul>
          </>
        )}
        <p>
          Wiadomości oczekujące w kolejce: <b>{s.mail}</b>.{" "}
          {process.env.MAIL_DELIVERY_ENABLED !== "true" &&
            "Wysyłanie wiadomości jest wyłączone."}
        </p>
        <p>
          Dostawy, płatności i regulamin można przygotować w ustawieniach.
          Włączenie zakupów wymaga ich zatwierdzenia.
        </p>
      </section>
    </>
  );
}
