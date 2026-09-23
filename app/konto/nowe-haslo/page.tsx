import { AuthPanel } from "../AuthPanel";
export const metadata = {
  title: "Ustaw nowe hasło — INNOCHEM",
  robots: { index: false, follow: false },
};
export default async function Reset({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="wrap account-page">
      {token ? (
        <AuthPanel resetToken={token} />
      ) : (
        <p>
          Brak poprawnego linku. Wróć do konta i poproś o nowy link do zmiany
          hasła.
        </p>
      )}
    </main>
  );
}
