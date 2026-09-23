import Link from "next/link";
import { adminPageUser } from "@/lib/server/admin-page";
import { query } from "@/lib/server/db";
export default async function Pages() {
  await adminPageUser();
  const { rows } = await query(
    "SELECT id,title,slug,published,updated_at FROM pages ORDER BY title",
  );
  return (
    <>
      <div className="admin-actions">
        <h2 className="display">Treści</h2>
        <Link className="btn btn-primary" href="/admin/tresci/nowa">
          Dodaj stronę
        </Link>
      </div>
      <div className="panel table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Tytuł</th>
              <th>Status</th>
              <th>Zmieniono</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>{p.title}</td>
                <td>{p.published ? "Opublikowana" : "Szkic"}</td>
                <td>{new Date(p.updated_at).toLocaleDateString("pl-PL")}</td>
                <td>
                  <Link href={`/admin/tresci/${p.id}`}>Edytuj</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p>Brak zapisanych stron.</p>}
      </div>
    </>
  );
}
