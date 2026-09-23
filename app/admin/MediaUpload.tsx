"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function MediaUpload() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="panel">
      <label className="f">
        Dodaj zdjęcie lub dokument PDF (do 15 MB)
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif,application/pdf"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError("");
            setMessage("");
            try {
              const r = await fetch("/api/admin/upload", {
                method: "POST",
                headers: { "Content-Type": "application/octet-stream" },
                body: file,
              });
              const d = await r.json();
              if (!r.ok) throw new Error(d.error);
              setMessage(`Plik zapisany: ${d.path}`);
              router.refresh();
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Nie udało się przesłać pliku.",
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {busy && <p role="status">Przesyłanie…</p>}
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
    </div>
  );
}
