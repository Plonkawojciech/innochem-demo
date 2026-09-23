import Link from "next/link";
import { adminPageUser } from "@/lib/server/admin-page";
import { query } from "@/lib/server/db";
import { InquiryEditor } from "../Editors";
export default async function Inquiries({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  await adminPageUser();
  const p = await searchParams,
    page = Math.max(1, Math.min(10000, Math.floor(Number(p.page) || 1))),
    status = ["new", "in_progress", "closed"].includes(p.status || "")
      ? p.status!
      : "";
  const { rows } = await query(
    "SELECT *,count(*) OVER()::int AS total FROM inquiries WHERE $1='' OR status=$1 ORDER BY created_at DESC LIMIT 30 OFFSET $2",
    [status, (page - 1) * 30],
  );
  return (
    <>
      <h2 className="display">Zapytania</h2>
      <form className="admin-search">
        <select
          name="status"
          aria-label="Status zapytania"
          defaultValue={status}
        >
          <option value="">Wszystkie</option>
          <option value="new">Nowe</option>
          <option value="in_progress">W obsłudze</option>
          <option value="closed">Zamknięte</option>
        </select>
        <button className="btn btn-outline">Filtruj</button>
      </form>
      {rows.map((i) => (
        <details className="panel" key={`${i.id}:${i.version}`}>
          <summary>
            {i.subject} — {i.name} ·{" "}
            {new Date(i.created_at).toLocaleDateString("pl-PL")} ·{" "}
            {i.status === "new"
              ? "Nowe"
              : i.status === "closed"
                ? "Zamknięte"
                : "W obsłudze"}
          </summary>
          <p>
            {i.email} · {i.phone}
          </p>
          <p className="pre-line">{i.message}</p>
          <InquiryEditor
            id={i.id}
            version={i.version}
            status={i.status}
            note={i.internal_note}
          />
        </details>
      ))}
      {!rows.length && <p className="panel">Brak zapytań.</p>}
      <div className="pagination">
        {page > 1 && (
          <Link href={`?status=${status}&page=${page - 1}`}>
            Poprzednia strona
          </Link>
        )}
        {rows[0]?.total > page * 30 && (
          <Link href={`?status=${status}&page=${page + 1}`}>
            Następna strona
          </Link>
        )}
      </div>
    </>
  );
}
