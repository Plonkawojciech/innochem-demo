"use client";
import { useState } from "react";
type Media = { id: string; path: string; mime_type: string; alt: string };
export function MediaPicker({
  productId,
  scope,
  kind = "image",
  onSelect,
  selected,
}: {
  productId?: string;
  scope?: "site";
  kind?: "image" | "document";
  onSelect: (media: Media) => void;
  selected: string[];
}) {
  const [open, setOpen] = useState(false),
    [items, setItems] = useState<Media[]>([]),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load(p = 1) {
    setOpen(true);
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/media?kind=${kind}&q=${encodeURIComponent(query)}&page=${p}${productId ? `&product=${productId}` : ""}${scope ? `&scope=${scope}` : ""}`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setItems(data.items);
      setPage(p);
      setTotal(data.total);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Nie udało się wczytać plików.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button
        type="button"
        className="btn btn-outline"
        onClick={() => (open ? setOpen(false) : void load())}
        aria-expanded={open}
      >
        {open ? "Zamknij bibliotekę" : "Wybierz z biblioteki"}
      </button>
      {open && (
        <section className="media-picker">
          <div className="admin-search">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={
                kind === "image"
                  ? "Szukaj zdjęcia w bibliotece"
                  : "Szukaj dokumentu w bibliotece"
              }
              placeholder="Nazwa pliku"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void load();
                }
              }}
            />
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void load()}
            >
              Szukaj
            </button>
          </div>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {busy ? (
            <p role="status">Wczytywanie…</p>
          ) : (
            <div className="media-editor">
              {items.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  disabled={selected.includes(m.id)}
                  onClick={() => onSelect(m)}
                  title={m.path}
                >
                  {kind === "image" ? (
                    <img src={m.path} alt={m.alt || "Zdjęcie z biblioteki"} />
                  ) : (
                    <strong>{m.path.split("/").pop()}</strong>
                  )}
                  <span>{selected.includes(m.id) ? "Wybrane" : "Dodaj"}</span>
                </button>
              ))}
            </div>
          )}
          {!busy && !items.length && <p>Brak pasujących plików.</p>}
          <div className="pagination">
            {page > 1 && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void load(page - 1)}
              >
                Poprzednia strona
              </button>
            )}
            {page * 24 < total && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void load(page + 1)}
              >
                Następna strona
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
