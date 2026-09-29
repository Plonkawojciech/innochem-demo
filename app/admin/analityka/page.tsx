import Link from "next/link";
import { adminPageUser } from "@/lib/server/admin-page";
import { query } from "@/lib/server/db";
export default async function AnalyticsQueue() {
  await adminPageUser();
  const { rows } =
    await query(`SELECT a.id,a.event_type,a.status,a.attempts,a.last_error,o.id AS order_id,o.number
    FROM analytics_outbox a JOIN orders o ON o.id=a.order_id ORDER BY a.created_at DESC LIMIT 100`);
  return (
    <section className="panel">
      <h2 className="display">Kolejka analityki</h2>
      <p>
        Ostatnie 100 zdarzeń. Status „sent” oznacza odpowiedź HTTP bez błędu;
        odbiór zdarzenia sprawdź w GA4.
      </p>
      {rows.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Zamówienie</th>
                <th>Zdarzenie</th>
                <th>Status</th>
                <th>Próby</th>
                <th>Błąd / powód pominięcia</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/admin/zamowienia/${a.order_id}`}>
                      {String(a.number)}
                    </Link>
                  </td>
                  <td>{a.event_type}</td>
                  <td>{a.status}</td>
                  <td>{a.attempts}</td>
                  <td>{a.last_error || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>Brak zdarzeń w kolejce.</p>
      )}
    </section>
  );
}
