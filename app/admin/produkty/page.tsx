import Link from "next/link";
import { adminPageUser } from "@/lib/server/admin-page";
import { query } from "@/lib/server/db";
import { money } from "@/lib/store-types";
export default async function Products({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await adminPageUser();
  const p = await searchParams;
  const page = Math.max(1, Math.min(10000, Math.floor(Number(p.page) || 1)));
  const q = (p.q || "").slice(0, 100);
  const { rows } = await query(
    "SELECT id,name,sku,price_cents,stock,reserved,status,count(*) OVER()::int AS total FROM products WHERE name ILIKE $1 OR sku ILIKE $1 ORDER BY name LIMIT 50 OFFSET $2",
    [`%${q.replace(/[\\%_]/g, "\\$&")}%`, (page - 1) * 50],
  );
  return (
    <>
      <div className="admin-actions">
        <h2 className="display">Produkty</h2>
        <Link className="btn btn-primary" href="/admin/produkty/nowy">
          Dodaj produkt
        </Link>
      </div>
      <form className="admin-search">
        <input
          aria-label="Szukaj produktów"
          name="q"
          defaultValue={q}
          placeholder="Nazwa lub kod produktu"
        />
        <button className="btn btn-outline">Szukaj</button>
      </form>
      <div className="panel table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Produkt</th>
              <th>Cena brutto</th>
              <th>Stan</th>
              <th>Rezerwacje</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <b>{p.name}</b>
                  <br />
                  {p.sku}
                </td>
                <td>{money(p.price_cents)}</td>
                <td>{p.stock}</td>
                <td>{p.reserved}</td>
                <td>
                  {p.status === "active"
                    ? "Aktywny"
                    : p.status === "draft"
                      ? "Szkic"
                      : "Archiwum"}
                </td>
                <td>
                  <Link href={`/admin/produkty/${p.id}`}>Edytuj</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p>Brak produktów.</p>}
      </div>
      <div className="pagination">
        {page > 1 && (
          <Link href={`?q=${encodeURIComponent(q)}&page=${page - 1}`}>
            Poprzednia strona
          </Link>
        )}
        {rows[0]?.total > page * 50 && (
          <Link href={`?q=${encodeURIComponent(q)}&page=${page + 1}`}>
            Następna strona
          </Link>
        )}
      </div>
    </>
  );
}
