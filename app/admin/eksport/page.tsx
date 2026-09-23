import { adminPageUser } from "@/lib/server/admin-page";
export default async function Export() {
  await adminPageUser();
  return (
    <>
      <h2 className="display">Eksport danych</h2>
      <section className="panel">
        <p>
          Pobierz dane sklepu do dalszej pracy lub przekazania. Eksport JSON
          obejmuje katalog, klientów, adresy, zamówienia, historię, treści i
          manifest zdjęć. Zdjęcia pobiera się osobno.
        </p>
        <p>
          Eksport nie zawiera haseł, sesji logowania ani linków do odzyskania
          konta. Pełna kopia techniczna bazy jest wykonywana odrębnie.
        </p>
        <p className="notice">
          Pliki z zamówieniami i klientami zawierają dane osobowe. Przechowuj je
          w bezpiecznym miejscu.
        </p>
        <div className="export-links">
          <a className="btn btn-primary" href="/api/admin/export?format=json">
            Dane sklepu — JSON
          </a>
          <a
            className="btn btn-outline"
            href="/api/admin/export?format=products"
          >
            Produkty — CSV
          </a>
          <a className="btn btn-outline" href="/api/admin/export?format=orders">
            Zamówienia — CSV
          </a>
          <a className="btn btn-outline" href="/api/admin/export?format=media">
            Wszystkie pliki — archiwum
          </a>
        </div>
      </section>
    </>
  );
}
