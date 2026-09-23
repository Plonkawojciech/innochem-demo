"use client";
import { useState, type FormEvent } from "react";
type Mode = "login" | "register" | "forgot" | "reset";
export function AuthPanel({
  resetToken,
  forgot = false,
}: {
  resetToken?: string;
  forgot?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(
    resetToken ? "reset" : forgot ? "forgot" : "login",
  );
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const f = new FormData(event.currentTarget);
    const get = (key: string) => String(f.get(key) || "");
    const endpoint = {
      login: "sign-in/email",
      register: "sign-up/email",
      forgot: "request-password-reset",
      reset: "reset-password",
    }[mode];
    const body =
      mode === "login"
        ? {
            email: get("email"),
            password: get("password"),
            rememberMe: f.get("remember") === "on",
          }
        : mode === "register"
          ? {
              name: get("name"),
              email: get("email"),
              password: get("password"),
              callbackURL: "/konto",
            }
          : mode === "forgot"
            ? { email: get("email"), redirectTo: "/konto/nowe-haslo" }
            : { token: resetToken, newPassword: get("password") };
    try {
      const response = await fetch(`/api/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        const code = data.code;
        throw new Error(
          code === "EMAIL_NOT_VERIFIED"
            ? "Potwierdź adres e-mail. Wysłaliśmy link do potwierdzenia."
            : code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
              ? "Konto może już istnieć. Zaloguj się lub ustaw nowe hasło."
              : response.status === 429
                ? "Za dużo prób. Odczekaj minutę."
                : mode === "reset"
                  ? "Link wygasł lub jest nieprawidłowy. Poproś o nowy link."
                  : "Sprawdź dane i spróbuj ponownie.",
        );
      }
      if (mode === "login")
        window.location.assign(
          new URLSearchParams(window.location.search).get("returnTo") ===
            "admin"
            ? "/admin"
            : "/konto",
        );
      else if (mode === "register")
        setMessage(
          "Sprawdź pocztę i potwierdź adres e-mail, aby korzystać z konta.",
        );
      else if (mode === "forgot")
        setMessage(
          "Jeśli konto istnieje, otrzymasz wiadomość z linkiem do ustawienia hasła.",
        );
      else {
        setMessage("Hasło zostało zmienione. Możesz się zalogować.");
        setMode("login");
        window.history.replaceState(null, "", "/konto");
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Nie udało się połączyć ze sklepem.",
      );
    } finally {
      setBusy(false);
    }
  }
  const title = {
    login: "Zaloguj się",
    register: "Utwórz konto",
    forgot: "Ustaw nowe hasło",
    reset: "Nowe hasło",
  }[mode];
  return (
    <section className="auth-panel panel">
      <h1 className="display">{title}</h1>
      <p>
        {mode === "login"
          ? "Sprawdź zamówienia i dane zapisane na Twoim koncie."
          : mode === "forgot"
            ? "Masz konto ze starego sklepu? Użyj tego samego adresu e-mail, aby ustawić nowe hasło."
            : ""}
      </p>
      <form onSubmit={submit}>
        {mode === "register" && (
          <label className="f">
            Imię i nazwisko
            <input name="name" required maxLength={180} autoComplete="name" />
          </label>
        )}
        {mode !== "reset" && (
          <label className="f">
            E-mail
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
            />
          </label>
        )}
        {mode !== "forgot" && (
          <label className="f">
            Hasło{mode !== "login" && " (co najmniej 12 znaków)"}
            <input
              name="password"
              type="password"
              required
              minLength={mode === "login" ? 1 : 12}
              maxLength={128}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
          </label>
        )}
        {mode === "login" && (
          <label className="check-label">
            <input name="remember" type="checkbox" />
            Zapamiętaj mnie na tym urządzeniu
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Proszę czekać…" : mode === "forgot" ? "Wyślij link" : title}
        </button>
      </form>
      {mode !== "reset" && (
        <div className="auth-links">
          {(["login", "register", "forgot"] as Mode[])
            .filter((m) => m !== mode)
            .map((m) => (
              <button
                type="button"
                className="text-button"
                key={m}
                onClick={() => {
                  setMode(m);
                  setError("");
                  setMessage("");
                }}
              >
                {m === "login"
                  ? "Mam już konto"
                  : m === "register"
                    ? "Załóż konto"
                    : "Nie pamiętasz hasła?"}
              </button>
            ))}
        </div>
      )}
    </section>
  );
}
export function SignOut() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="text-button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await fetch("/api/auth/sign-out", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (r.ok) window.location.assign("/konto");
        else setBusy(false);
      }}
    >
      Wyloguj się
    </button>
  );
}
