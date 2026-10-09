import Link from "next/link";
import type { StoreCategory } from "@/lib/store-types";

const mainCategories = [
  "oleje-samochodowe",
  "oleje-motocyklowe",
  "oleje-wyscigowe",
];

function href(base: string, params: { q?: string; grade?: string | null }) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.grade) query.set("g", params.grade);
  return query.size ? `${base}?${query}` : base;
}

/** Compact catalog toolbar: title, count and search on one line, category and grade chips on the next. */
export function CatalogToolbar({
  title,
  base,
  categories,
  activeCategory,
  grades,
  grade,
  q,
  total,
}: {
  title: string;
  base: string;
  categories: StoreCategory[];
  activeCategory: string | null;
  grades: { grade: string; count: number }[];
  grade: string | null;
  q: string;
  total: number;
}) {
  return (
    <div className="toolbar">
      <div className="toolbar-top">
        <h1 className="display">
          {title}
          <span className="result-count" aria-live="polite">
            {total === 1 ? "1 produkt" : `${total} produktów`}
            {q ? ` dla „${q}”` : ""}
          </span>
        </h1>
        <form className="search-box" role="search" action={base}>
          <label htmlFor="product-search" className="sr-only">
            Szukaj produktu
          </label>
          <input
            id="product-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Szukaj: 5W30, HPS, Max ATF"
            maxLength={120}
          />
          {grade && <input type="hidden" name="g" value={grade} />}
          <button type="submit" aria-label="Szukaj">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </button>
        </form>
      </div>
      <div className="toolbar-chips">
        <div className="chips" aria-label="Kategoria">
          <Link
            href={href("/katalog", { q, grade })}
            prefetch={false}
            className={!activeCategory ? "chip on" : "chip"}
          >
            Wszystkie
          </Link>
          {categories
            .filter((c) => mainCategories.includes(c.slug))
            .map((c) => (
              <Link
                key={c.id}
                href={href(`/kategoria/${c.slug}`, { grade })}
                prefetch={false}
                className={activeCategory === c.slug ? "chip on" : "chip"}
              >
                {c.name.replace(/^Oleje\s+/i, "")}
              </Link>
            ))}
          <Link href="/przemysl" className="chip" prefetch={false}>
            Przemysł
          </Link>
        </div>
        {grades.length > 1 && (
          <div className="chips chips-grades" aria-label="Klasa lepkości">
            <span className="chips-name">Lepkość</span>
            <Link
              href={href(base, { q, grade: null })}
              className={!grade ? "chip on" : "chip"}
            >
              Każda
            </Link>
            {grades.map((g) => (
              <Link
                key={g.grade}
                href={href(base, {
                  q,
                  grade: g.grade === grade ? null : g.grade,
                })}
                className={g.grade === grade ? "chip on" : "chip"}
                aria-current={g.grade === grade ? "true" : undefined}
              >
                {g.grade}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
