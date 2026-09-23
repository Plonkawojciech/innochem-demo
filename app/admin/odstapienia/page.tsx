import Link from "next/link";
import { adminPageUser } from "@/lib/server/admin-page";
import { query } from "@/lib/server/db";
import { WithdrawalEditor } from "./WithdrawalEditor";
export default async function Withdrawals({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  await adminPageUser();
  const p = await searchParams,
    page = Math.max(1, Math.min(10000, Math.floor(Number(p.page) || 1))),
    status = ["received", "in_review", "closed"].includes(p.status || "")
      ? p.status!
      : "";
  const rows = (
    await query(
      "SELECT id,reference,status,version,preview,created_at,receipt_text,internal_note,count(*) OVER()::int total FROM withdrawals WHERE $1='' OR status=$1 ORDER BY created_at DESC,id LIMIT 30 OFFSET $2",
      [status, (page - 1) * 30],
    )
  ).rows;
  return (
    <>
      <h2 className="display">Odstąpienia od umowy</h2>
      <form className="admin-search">
        <select
          name="status"
          aria-label="Status odstąpienia"
          defaultValue={status}
        >
          <option value="">Wszystkie</option>
          <option value="received">Otrzymane</option>
          <option value="in_review">W obsłudze</option>
          <option value="closed">Obsługa zakończona</option>
        </select>
        <button className="btn btn-outline">Filtruj</button>
      </form>
      {!rows.length && <p className="panel">Brak zgłoszeń.</p>}
      {rows.map((r) => (
        <details className="panel" key={`${r.id}:${r.version}`}>
          <summary>
            OD-{r.reference} · {new Date(r.created_at).toLocaleString("pl-PL")}{" "}
            ·{" "}
            {r.status === "received"
              ? "Otrzymane"
              : r.status === "closed"
                ? "Obsługa zakończona"
                : "W obsłudze"}
            {r.preview ? " · TEST" : ""}
          </summary>
          <pre className="withdrawal-receipt">{r.receipt_text}</pre>
          <WithdrawalEditor
            id={r.id}
            version={r.version}
            status={r.status}
            note={r.internal_note}
          />
        </details>
      ))}
      <nav className="pagination" aria-label="Strony zgłoszeń">
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
      </nav>
    </>
  );
}
