import Link from "next/link";
/** Split auth layout: form on the left, brand panel with the hero bottle on the right. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <div className="auth-form-col">
        <Link href="/" className="auth-back">
          ← Wróć do sklepu
        </Link>
        <div className="auth-form-inner">{children}</div>
        <p className="auth-foot">
          <Link href="/regulamin">Regulamin</Link>
          <Link href="/polityka-prywatnosci">Prywatność</Link>
          <Link href="/kontakt">Kontakt</Link>
        </p>
      </div>
      <aside className="auth-brand" aria-hidden>
        <img
          src="/img/rp-hps-5w30-hd.webp"
          alt=""
          width={600}
          height={840}
          decoding="async"
        />
        <div className="auth-brand-copy">
          <span className="kicker">Twoje konto INNOCHEM</span>
          <ul>
            <li>
              <b>Historia zamówień</b>
              <span>
                Także zamówienia ze starego sklepu, pod tym samym e-mailem.
              </span>
            </li>
            <li>
              <b>Zapisane adresy</b>
              <span>Szybsze zamówienia bez przepisywania danych.</span>
            </li>
            <li>
              <b>Status zamówienia</b>
              <span>Sprawdzisz, na jakim etapie jest Twoja przesyłka.</span>
            </li>
          </ul>
        </div>
      </aside>
    </main>
  );
}
