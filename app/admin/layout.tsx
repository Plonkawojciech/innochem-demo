import Link from "next/link";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Panel sklepu — INNOCHEM",
  robots: { index: false, follow: false },
};
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="wrap admin-shell">
      <div className="admin-heading">
        <div>
          <p className="label">INNOCHEM</p>
          <h1 className="display">Panel sklepu</h1>
        </div>
        <Link href="/konto">Moje konto</Link>
      </div>
      <nav className="admin-nav" aria-label="Panel sklepu">
        {[
          ["", "Przegląd"],
          ["produkty", "Produkty"],
          ["kategorie", "Kategorie"],
          ["zamowienia", "Zamówienia"],
          ["zapytania", "Zapytania"],
          ["odstapienia", "Odstąpienia"],
          ["tresci", "Treści"],
          ["witryna", "Wygląd i treści witryny"],
          ["media", "Pliki"],
          ["ustawienia", "Ustawienia"],
          ["eksport", "Eksport"],
        ].map(([url, title]) => (
          <Link key={url} href={`/admin${url ? `/${url}` : ""}`}>
            {title}
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}
