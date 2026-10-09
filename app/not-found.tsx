import Link from "next/link";

export default function NotFound() {
  return (
    <main className="wrap">
      <section className="empty-state" aria-labelledby="not-found-title">
        <p>404</p>
        <h1 id="not-found-title" className="display">
          Nie znaleziono strony
        </h1>
        <p>
          Ta strona lub produkt nie są dostępne. Sprawdź adres albo przejdź do
          katalogu, aby znaleźć produkty Royal Purple.
        </p>
        <Link href="/katalog" className="btn btn-primary" prefetch={false}>
          Przejdź do katalogu
        </Link>
      </section>
    </main>
  );
}
