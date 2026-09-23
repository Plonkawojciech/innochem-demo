import Link from "next/link";
import { adminPageUser } from "@/lib/server/admin-page";
import { query } from "@/lib/server/db";
import { money } from "@/lib/store-types";
import { orderLabels } from "@/lib/order-labels";
export default async function Orders({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string }>;
}) {
  await adminPageUser();
  const p = await searchParams;
  const page = Math.max(1, Math.min(10000, Math.floor(Number(p.page) || 1))),
    q = (p.q || "").slice(0, 100),
    status = p.status && Object.hasOwn(orderLabels, p.status) ? p.status : "";
  const { rows } = await query(
    "SELECT id,number,legacy_id,email,status,total_cents,currency,created_at,count(*) OVER()::int AS total FROM orders WHERE ($1='' OR status=$1) AND (email ILIKE $2 OR number::text=$3 OR legacy_id::text=$3) ORDER BY created_at DESC LIMIT 50 OFFSET $4",
    [status, `%${q.replace(/[\\%_]/g, "\\$&")}%`, q, (page - 1) * 50],
  );
  const url = (n: number) =>
    `?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&page=${n}`;
  return (
    <>
      <h2 className="display">Zamówienia</h2>
      <form className="admin-search">
        <input
          name="q"
          aria-label="Numer zamówienia lub e-mail"
          placeholder="Numer lub e-mail"
          defaultValue={q}
        />
        <select name="status" aria-label="Status" defaultValue={status}>
          <option value="">Wszystkie statusy</option>
          {Object.entries(orderLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button className="btn btn-outline">Szukaj</button>
      </form>
      <div className="panel table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Numer</th>
              <th>Data</th>
              <th>Klient</th>
              <th>Status</th>
              <th>Kwota</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td>{o.legacy_id ? `Archiwum ${o.legacy_id}` : o.number}</td>
                <td>{new Date(o.created_at).toLocaleDateString("pl-PL")}</td>
                <td>{o.email || "Brak w archiwum"}</td>
                <td>{orderLabels[o.status]}</td>
                <td>{money(o.total_cents, o.currency)}</td>
                <td>
                  <Link href={`/admin/zamowienia/${o.id}`}>Otwórz</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p>Brak zamówień.</p>}
      </div>
      <div className="pagination">
        {page > 1 && <Link href={url(page - 1)}>Poprzednia strona</Link>}
        {rows[0]?.total > page * 50 && (
          <Link href={url(page + 1)}>Następna strona</Link>
        )}
      </div>
    </>
  );
}
