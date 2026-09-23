import Link from "next/link";
import { headers } from "next/headers";
import { session, customerForSession } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import { accountOverview } from "@/lib/server/account";
import { orderLabels } from "@/lib/order-labels";
import { AddressBook, ProfileForm } from "./AccountForms";
import { money } from "@/lib/store-types";
import { AuthPanel, SignOut } from "./AuthPanel";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Moje konto — INNOCHEM",
  robots: { index: false, follow: false },
};
export default async function Account({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tryb?: string }>;
}) {
  const requestHeaders = await headers();
  const current = await session(requestHeaders);
  if (!current)
    return (
      <main className="wrap account-page">
        <AuthPanel forgot={(await searchParams).tryb === "haslo"} />
      </main>
    );
  const customerId = await customerForSession(requestHeaders);
  if (!customerId)
    return (
      <main className="wrap account-page">
        <p className="notice">
          Potwierdź adres e-mail, aby otworzyć dane konta.
        </p>
        <SignOut />
      </main>
    );
  const requestedPage = Math.max(
    1,
    Math.floor(Number((await searchParams).page) || 1),
  );
  const { profile, addresses, orders, total, page } = await accountOverview(
    customerId,
    requestedPage,
  );
  const { rows: users } = await query(
    "SELECT role FROM auth_user WHERE id=$1",
    [current.user.id],
  );
  return (
    <main className="wrap account-page">
      <div className="account-heading">
        <div>
          <p className="label">Moje konto</p>
          <h1 className="display">{current.user.name}</h1>
          <p>{current.user.email}</p>
        </div>
        <SignOut />
      </div>
      {users[0]?.role === "admin" && (
        <p className="notice">
          <Link href="/admin">Przejdź do panelu sklepu</Link>
        </p>
      )}
      <section className="panel">
        <h2 className="display">Twoje zamówienia</h2>
        {!orders.length ? (
          <p>
            Nie masz jeszcze zamówień.{" "}
            <Link href="/katalog">Zobacz produkty</Link>.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Numer</th>
                  <th>Data</th>
                  <th>Status</th>
                  <th>Wartość</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      {o.legacy_id ? `Archiwum ${o.legacy_id}` : o.number}
                    </td>
                    <td>
                      {new Date(o.created_at).toLocaleDateString("pl-PL")}
                    </td>
                    <td>
                      {o.status === "legacy"
                        ? o.legacy_status || "Archiwum"
                        : orderLabels[o.status] || o.status}
                    </td>
                    <td>{money(o.total_cents, o.currency)}</td>
                    <td>
                      <Link href={`/zamowienie/${o.id}`}>Szczegóły</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <nav className="pagination" aria-label="Strony historii zamówień">
        {page > 1 && (
          <Link href={`/konto?page=${page - 1}`}>Poprzednia strona</Link>
        )}
        <span>
          Strona {page} z {Math.max(1, Math.ceil(total / 25))}
        </span>
        {page * 25 < total && (
          <Link href={`/konto?page=${page + 1}`}>Następna strona</Link>
        )}
      </nav>
      <section className="panel">
        <AddressBook
          addresses={
            addresses as Parameters<typeof AddressBook>[0]["addresses"]
          }
          firstName={profile.first_name}
          lastName={profile.last_name}
        />
      </section>
      <section className="panel">
        <h2 className="display">Twoje dane</h2>
        <ProfileForm
          key={profile.version}
          firstName={profile.first_name}
          lastName={profile.last_name}
          version={profile.version}
        />
        <p className="muted">
          Zmiana zapisanych danych nie zmienia wcześniejszych zamówień.
        </p>
      </section>
    </main>
  );
}
