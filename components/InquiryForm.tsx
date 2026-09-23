"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
export function InquiryForm({
  subject = "Dobór oleju",
  preview = false,
}: {
  subject?: string;
  preview?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(
            [...f.entries()].map(([k, v]) => [
              k,
              k === "privacy" ? v === "on" : v,
            ]),
          ),
        ),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setDone(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Nie udało się zapisać wiadomości.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (done)
    return (
      <div className="notice" role="status">
        <h2>
          {preview ? "Zapytanie testowe zapisane" : "Dziękujemy za wiadomość"}
        </h2>
        <p>
          {preview
            ? "W tym podglądzie wiadomości nie są wysyłane."
            : "Odpowiemy w godzinach pracy: poniedziałek–piątek 8:00–16:00."}
        </p>
      </div>
    );
  return (
    <form className="panel inquiry-form" onSubmit={submit}>
      <h2 className="display">Zadaj pytanie</h2>
      <div className="f-grid">
        <label className="f">
          Imię i nazwisko
          <input
            name="name"
            autoComplete="name"
            required
            minLength={2}
            maxLength={120}
          />
        </label>
        <label className="f">
          E-mail
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
        </label>
        <label className="f">
          Telefon (opcjonalnie)
          <input name="phone" autoComplete="tel" maxLength={30} />
        </label>
        <label className="f">
          Temat
          <input
            name="subject"
            defaultValue={subject}
            required
            minLength={2}
            maxLength={200}
          />
        </label>
        <label className="f full">
          Wiadomość
          <textarea
            name="message"
            rows={6}
            required
            minLength={10}
            maxLength={6000}
          />
        </label>
      </div>
      <div className="honeypot" aria-hidden="true">
        <label>
          Strona internetowa
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="check-label">
        <input name="privacy" type="checkbox" required />
        <span>
          Potwierdzam zapoznanie się z{" "}
          <Link href="/polityka-prywatnosci">polityką prywatności</Link>{" "}
          dotyczącą obsługi zapytania.
        </span>
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button className="btn btn-primary" disabled={busy}>
        {busy
          ? "Zapisywanie…"
          : preview
            ? "Zapisz zapytanie testowe"
            : "Wyślij zapytanie"}
      </button>
    </form>
  );
}
