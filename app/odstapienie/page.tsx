import Link from "next/link";
import { WithdrawalForm } from "./WithdrawalForm";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Odstąp od umowy — INNOCHEM",
  robots: { index: false, follow: false },
};
export default async function Withdrawal({
  searchParams,
}: {
  searchParams: Promise<{ zamowienie?: string }>;
}) {
  const p = await searchParams,
    reference =
      typeof p.zamowienie === "string" ? p.zamowienie.slice(0, 180) : "";
  const preview = process.env.STOREFRONT_PREVIEW !== "false";
  return (
    <main className="wrap withdrawal-page">
      <p className="label">Obsługa zakupu</p>
      <h1 className="display">Odstąp od umowy</h1>
      <p>
        Możesz złożyć oświadczenie bez logowania. Wpisz dane zakupu, sprawdź
        treść i potwierdź wysłanie. Otrzymasz potwierdzenie z datą przyjęcia.
      </p>
      <p>
        <Link href="/zwroty-i-reklamacje">Warunki zwrotów i reklamacji</Link>
      </p>
      {preview && (
        <p className="notice">
          To podgląd nowego sklepu. Formularz zapisuje tylko zgłoszenie testowe.
        </p>
      )}
      <WithdrawalForm preview={preview} reference={reference} />
    </main>
  );
}
