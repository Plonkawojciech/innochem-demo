import Link from "next/link";
import { notFound } from "next/navigation";
import { informationPage } from "@/lib/server/pages";
import { legalSlugs } from "@/lib/server/legal";
export const dynamic = "force-dynamic";
const legalTitles: Record<string, string> = {
  regulamin: "Regulamin sklepu",
  "polityka-prywatnosci": "Polityka prywatności",
  "zwroty-i-reklamacje": "Zwroty i reklamacje",
  "dostawa-i-platnosci": "Dostawa i płatności",
  "polityka-cookies": "Polityka cookies",
};
function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
/** Adds ids to h2 headings and returns the table of contents built from them. */
function withAnchors(html: string) {
  const toc: { id: string; label: string }[] = [];
  const body = html.replace(
    /<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/gi,
    (match, attrs: string | undefined, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, "").trim();
      if (!label || /\sid=/.test(attrs || "")) return match;
      let id = slugify(label) || `sekcja-${toc.length + 1}`;
      if (toc.some((t) => t.id === id)) id = `${id}-${toc.length + 1}`;
      toc.push({ id, label });
      return `<h2${attrs || ""} id="${id}">${inner}</h2>`;
    },
  );
  return { body, toc };
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const page = await informationPage((await params).slug);
  return {
    title: page
      ? `${page.title} — INNOCHEM`
      : "Nie znaleziono strony — INNOCHEM",
    description: page?.meta_description,
    alternates: { canonical: `/${(await params).slug}` },
    ...(!page?.published ? { robots: { index: false, follow: false } } : {}),
  };
}
export default async function Information({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const page = await informationPage((await params).slug);
  if (!page) notFound();
  const legal = legalSlugs.includes(page.slug);
  const { body, toc } = withAnchors(page.body_html);
  const updated = new Date(page.updated_at).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return (
    <main className={legal ? "wrap doc-page" : "wrap information-page"}>
      <p className="crumbs">
        <Link href="/">Strona główna</Link> / {page.title}
      </p>
      <header className="doc-head">
        {legal && <span className="label">Dokumenty sklepu</span>}
        <h1 className="display">{page.title}</h1>
        <p className="doc-meta">
          {legal && page.published && <span>Wersja obowiązująca</span>}
          <span>Ostatnia aktualizacja: {updated}</span>
        </p>
      </header>
      {!page.published && (
        <p className="notice doc-draft">
          Wersja robocza widoczna w podglądzie. Dokument oczekuje na
          uzupełnienie i zatwierdzenie.
        </p>
      )}
      <div className={toc.length > 2 ? "doc-grid" : "doc-grid single"}>
        {toc.length > 2 && (
          <nav className="doc-toc" aria-label="Spis treści">
            <span className="doc-toc-title">Spis treści</span>
            <ol>
              {toc.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`}>{t.label}</a>
                </li>
              ))}
            </ol>
            {legal && (
              <div className="doc-help">
                <b>Masz pytanie?</b>
                <a href="mailto:sklep@innochem.pl">sklep@innochem.pl</a>
                <a href="tel:+48602155919">602 155 919</a>
              </div>
            )}
          </nav>
        )}
        <article
          className="prose doc-body"
          dangerouslySetInnerHTML={{ __html: body }}
        />
      </div>
      {legal && (
        <nav className="doc-others" aria-label="Pozostałe dokumenty">
          <span className="doc-toc-title">Pozostałe dokumenty</span>
          <div>
            {legalSlugs
              .filter((s) => s !== page.slug)
              .map((s) => (
                <Link key={s} href={`/${s}`}>
                  {legalTitles[s] || s}
                </Link>
              ))}
            <Link href="/odstapienie">Formularz odstąpienia od umowy</Link>
          </div>
        </nav>
      )}
    </main>
  );
}
