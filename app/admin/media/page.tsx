import Link from "next/link";
import { adminPageUser } from "@/lib/server/admin-page";
import { query } from "@/lib/server/db";
import { MediaUpload } from "../MediaUpload";
export default async function Media({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  await adminPageUser();
  const p = await searchParams,
    page = Math.max(1, Math.min(10000, Math.floor(Number(p.page) || 1))),
    q = (p.q || "").slice(0, 100);
  const { rows } = await query(
    "SELECT id,path,mime_type,alt,size_bytes,count(*) OVER()::int AS total FROM media WHERE path ILIKE $1 OR alt ILIKE $1 ORDER BY created_at DESC,path LIMIT 48 OFFSET $2",
    [`%${q.replace(/[\\%_]/g, "\\$&")}%`, (page - 1) * 48],
  );
  return (
    <>
      <h2 className="display">Biblioteka plików</h2>
      <MediaUpload />
      <form className="admin-search">
        <input
          name="q"
          aria-label="Szukaj plików"
          placeholder="Nazwa lub opis pliku"
          defaultValue={q}
        />
        <button className="btn btn-outline">Szukaj</button>
      </form>
      <div className="media-library">
        {rows.map((m) => (
          <article className="panel" key={m.id}>
            {m.mime_type.startsWith("image/") ? (
              <img loading="lazy" src={m.path} alt={m.alt} />
            ) : (
              <div className="document-icon">PDF</div>
            )}
            <a href={m.path} target="_blank" rel="noopener noreferrer">
              Otwórz plik
            </a>
            <label className="f">
              Adres do wklejenia
              <input
                readOnly
                value={m.path}
                aria-label={`Adres pliku ${m.path}`}
                onFocus={undefined}
              />
            </label>
            <small>{Math.round(Number(m.size_bytes) / 1024)} KB</small>
          </article>
        ))}
      </div>
      <div className="pagination">
        {page > 1 && (
          <Link href={`?q=${encodeURIComponent(q)}&page=${page - 1}`}>
            Poprzednia strona
          </Link>
        )}
        {rows[0]?.total > page * 48 && (
          <Link href={`?q=${encodeURIComponent(q)}&page=${page + 1}`}>
            Następna strona
          </Link>
        )}
      </div>
    </>
  );
}
