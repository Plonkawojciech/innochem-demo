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

export function CatalogFilters({
  base,
  categories,
  activeCategory,
  grades,
  grade,
  q,
  total,
}: {
  base: string;
  categories: StoreCategory[];
  activeCategory: string | null;
  grades: { grade: string; count: number }[];
  grade: string | null;
  q: string;
  total: number;
}) {
  return (
    <div className="filters">
      <div className="filter-row">
        <span className="filter-name">Kategoria</span>
        <div className="chips">
          <Link
            href={href("/katalog", { q, grade })}
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
                className={activeCategory === c.slug ? "chip on" : "chip"}
              >
                {c.name.replace(/^Oleje\s+/i, "")}
              </Link>
            ))}
          <Link href="/przemysl" className="chip">
            Przemysł
          </Link>
        </div>
      </div>
      {grades.length > 1 && (
        <div className="filter-row">
          <span className="filter-name">Lepkość</span>
          <div className="chips">
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
                aria-pressed={g.grade === grade}
              >
                {g.grade}
                <small>{g.count}</small>
              </Link>
            ))}
          </div>
        </div>
      )}
      <form className="filter-row search-row" role="search" action={base}>
        <label htmlFor="product-search" className="filter-name">
          Szukaj
        </label>
        <div className="search-box">
          <input
            id="product-search"
            name="q"
            defaultValue={q}
            placeholder="np. 5W30, HPS, Max ATF"
            maxLength={120}
          />
          {grade && <input type="hidden" name="g" value={grade} />}
          <button type="submit">Szukaj</button>
        </div>
        <span className="result-count" aria-live="polite">
          {total === 1 ? "1 produkt" : `${total} produktów`}
          {q ? ` dla „${q}”` : ""}
        </span>
      </form>
    </div>
  );
}
