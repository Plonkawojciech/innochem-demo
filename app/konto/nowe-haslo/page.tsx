import { AuthPanel } from "../AuthPanel";
import { AuthShell } from "../AuthShell";
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
    <AuthShell>
      {token ? (
        <AuthPanel resetToken={token} />
      ) : (
        <p className="notice">
          Brak poprawnego linku. Wróć do konta i poproś o nowy link do zmiany
          hasła.
        </p>
      )}
    </AuthShell>
  );
}
