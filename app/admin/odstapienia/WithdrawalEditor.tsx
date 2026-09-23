"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
export function WithdrawalEditor({
  id,
  version,
  status,
  note,
}: {
  id: string;
  version: number;
  status: string;
  note: string;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch(`/api/admin/withdrawals/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version,
          status: f.get("status"),
          note: f.get("note"),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się zapisać.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <label className="f">
        Status obsługi
        <select name="status" defaultValue={status}>
          <option value="received">Otrzymane</option>
          <option value="in_review">W obsłudze</option>
          <option value="closed">Obsługa zakończona</option>
        </select>
      </label>
      <label className="f">
        Notatka wewnętrzna
        <textarea name="note" defaultValue={note} maxLength={6000} rows={3} />
      </label>
      <p>
        Status dotyczy obsługi zgłoszenia. Nie anuluje zamówienia, nie wykonuje
        zwrotu płatności ani nie przyjmuje towaru do magazynu. Te czynności
        rozlicz w zamówieniu po sprawdzeniu zgłoszenia.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Zapisywanie…" : "Zapisz obsługę"}
      </button>
    </form>
  );
}
