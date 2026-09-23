import { adminPageUser } from "@/lib/server/admin-page";
import {
  stripeConfigured,
  stripeCheckoutReady,
} from "@/lib/server/stripe-config";
import { query } from "@/lib/server/db";
import { settingsSchema } from "@/lib/server/settings";
import { SettingsEditor } from "../SettingsEditor";
export default async function Settings() {
  await adminPageUser();
  const {
    rows: [s],
  } = await query("SELECT value,version FROM settings WHERE key='store'");
  return (
    <>
      <h2 className="display">Ustawienia sklepu</h2>
      <section className="panel">
        <h3>Płatności online</h3>
        <p>
          Stripe:{" "}
          {stripeConfigured()
            ? "klucz i podpis webhooka skonfigurowane"
            : "oczekuje na konfigurację"}
          . Tryb:{" "}
          {process.env.STRIPE_MODE === "live"
            ? "rzeczywisty"
            : process.env.STRIPE_MODE === "test"
              ? "testowy"
              : "nieustawiony"}
          .
        </p>
        <p>
          Rozpoczynanie płatności:{" "}
          <b>{stripeCheckoutReady() ? "włączone technicznie" : "wyłączone"}</b>.
          Dostępność w kasie wymaga też włączenia Stripe poniżej i zatwierdzenia
          warunków sklepu.
        </p>
        <p>
          Obsługiwane metody: BLIK, Przelewy24 i karty. Apple Pay jest dostępne
          przy płatności kartą na zgodnym urządzeniu. Metody muszą być aktywne
          na koncie Stripe.
        </p>
        <p>
          Klucze operatora konfiguruje się w bezpiecznych ustawieniach serwera.
          Panel nie wyświetla ich wartości.
        </p>
      </section>
      <SettingsEditor
        value={settingsSchema.parse(s.value)}
        version={s.version}
      />
    </>
  );
}
