"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
export function CmsPreviewBar() {
  const [error, setError] = useState("");
  const router = useRouter();
  return (
    <div className="cms-preview-bar">
      <span>Oglądasz zapisany szkic witryny.</span>{" "}
      <Link href="/admin/witryna">Wróć do edycji</Link>
      <button
        type="button"
        onClick={async () => {
          try {
            const r = await fetch("/api/admin/site-preview", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enabled: false }),
            });
            if (!r.ok) throw new Error();
            router.refresh();
          } catch {
            setError("Nie udało się wyłączyć podglądu. Spróbuj ponownie.");
          }
        }}
      >
        Zakończ podgląd
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
