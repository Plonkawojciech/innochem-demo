import Link from "next/link";
import { notFound } from "next/navigation";
import { informationPage } from "@/lib/server/pages";
export const dynamic = "force-dynamic";
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
  return (
    <main className="wrap information-page">
      <p className="crumbs">
        <Link href="/">Strona główna</Link> / {page.title}
      </p>
      <h1 className="display">{page.title}</h1>
      {!page.published && (
        <p className="notice">
          Wersja robocza widoczna w podglądzie. Dokument oczekuje na
          uzupełnienie i zatwierdzenie.
        </p>
      )}
      <article
        className="prose"
        dangerouslySetInnerHTML={{ __html: page.body_html }}
      />
    </main>
  );
}
