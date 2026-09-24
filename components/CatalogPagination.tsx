import Link from "next/link";
export function CatalogPagination({
  page,
  pages,
  path,
  search = "",
  grade = null,
}: {
  page: number;
  pages: number;
  path: string;
  search?: string;
  grade?: string | null;
}) {
  if (pages <= 1) return null;
  function url(n: number) {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (grade) params.set("g", grade);
    if (n > 1) params.set("page", String(n));
    return `${path}${params.size ? `?${params}` : ""}`;
  }
  return (
    <nav className="pagination" aria-label="Strony katalogu">
      {page > 1 && <Link href={url(page - 1)}>Poprzednia strona</Link>}
      <span>
        Strona {page} z {pages}
      </span>
      {page < pages && <Link href={url(page + 1)}>Następna strona</Link>}
    </nav>
  );
}
