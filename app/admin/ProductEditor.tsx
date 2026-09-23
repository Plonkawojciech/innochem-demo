"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { RichTextEditor } from "./RichTextEditor";
import { MediaPicker } from "./MediaPicker";
type Media = { id: string; path: string; mime_type: string; alt: string };
type Document = {
  mediaId: string;
  label: string;
  archival: boolean;
  path: string;
};
type Product = {
  id: string;
  version: number;
  name: string;
  slug: string;
  sku: string;
  summary: string;
  description_html: string;
  price_cents: number;
  tax_rate: string;
  stock: number;
  reserved: number;
  status: string;
  sale_mode: string;
  weight_grams: number;
  meta_title: string;
  meta_description: string;
  image_alt: string;
  categoryIds: string[];
  media: Media[];
  documents: Document[];
};
export function ProductEditor({
  product,
  categories,
}: {
  product: Product | null;
  categories: { id: string; name: string }[];
}) {
  const [media, setMedia] = useState(product?.media || []);
  const [documents, setDocuments] = useState<Document[]>(
    product?.documents || [],
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(product?.version);
  async function upload(file: File, document = false) {
    setUploading(true);
    setError("");
    try {
      const r = await fetch("/api/admin/upload", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (document) {
        if (d.mime_type !== "application/pdf")
          throw new Error(
            "Wybierz plik PDF. Inny plik pozostanie w bibliotece.",
          );
        setDocuments((list) => [
          ...list,
          { mediaId: d.id, path: d.path, label: file.name, archival: false },
        ]);
        return;
      }
      if (!d.mime_type.startsWith("image/"))
        throw new Error(
          "Dokument zapisano w plikach. W galerii wybierz zdjęcie.",
        );
      setMedia((m) => [...m, d]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nie udało się dodać zdjęcia.");
    } finally {
      setUploading(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const f = new FormData(e.currentTarget),
      s = (k: string) => String(f.get(k) || ""),
      n = (k: string) => Number(s(k).replace(",", "."));
    const body = {
      version,
      name: s("name"),
      slug: s("slug"),
      sku: s("sku"),
      summary: s("summary"),
      descriptionHtml: s("descriptionHtml"),
      priceCents: Math.round(n("price") * 100),
      taxRate: n("taxRate"),
      stock: n("stock"),
      status: s("status"),
      saleMode: s("saleMode"),
      weightGrams: n("weightGrams"),
      metaTitle: s("metaTitle"),
      metaDescription: s("metaDescription"),
      imageAlt: s("imageAlt"),
      categoryIds: f.getAll("categoryIds"),
      mediaIds: media.map((m) => m.id),
      documents: documents.map(({ mediaId, label, archival }) => ({
        mediaId,
        label,
        archival,
      })),
    };
    try {
      const r = await fetch(
        `/api/admin/products${product ? `/${product.id}` : ""}`,
        {
          method: product ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (!product) window.location.assign(`/admin/produkty/${d.id}`);
      else {
        setVersion(d.version);
        setMessage("Zmiany zostały zapisane.");
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Nie udało się zapisać produktu.",
      );
    } finally {
      setBusy(false);
    }
  }
  function move(index: number, delta: number) {
    setMedia((list) => {
      const next = [...list];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  }
  return (
    <form onSubmit={submit} className="admin-editor">
      <div className="admin-actions">
        <h2 className="display">{product ? product.name : "Nowy produkt"}</h2>
        <Link href="/admin/produkty">Lista produktów</Link>
      </div>
      <div className="admin-columns">
        <section className="panel">
          <label className="f">
            Nazwa produktu
            <input
              name="name"
              defaultValue={product?.name}
              required
              maxLength={180}
            />
          </label>
          <label className="f">
            Adres produktu (małe litery, cyfry i łączniki)
            <input
              name="slug"
              defaultValue={product?.slug}
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={180}
            />
          </label>
          <label className="f">
            Kod produktu / SKU
            <input name="sku" defaultValue={product?.sku} maxLength={100} />
          </label>
          <label className="f">
            Krótki opis
            <textarea
              name="summary"
              rows={3}
              maxLength={2000}
              defaultValue={product?.summary}
            />
          </label>
          <RichTextEditor
            name="descriptionHtml"
            label="Opis produktu"
            initial={product?.description_html}
          />
          <details>
            <summary>Wyszukiwarki</summary>
            <label className="f">
              Tytuł strony
              <input
                name="metaTitle"
                defaultValue={product?.meta_title}
                maxLength={180}
              />
            </label>
            <label className="f">
              Opis w wynikach wyszukiwania
              <textarea
                name="metaDescription"
                defaultValue={product?.meta_description}
                maxLength={320}
              />
            </label>
          </details>
        </section>
        <div>
          <section className="panel">
            <div className="field-grid">
              <label className="f">
                Cena brutto (zł)
                <input
                  name="price"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100000"
                  required
                  defaultValue={(product?.price_cents || 0) / 100}
                />
              </label>
              <label className="f">
                VAT (%)
                <input
                  name="taxRate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  required
                  defaultValue={product?.tax_rate ?? 23}
                />
              </label>
              <label className="f">
                Stan całkowity (szt.)
                <input
                  name="stock"
                  type="number"
                  min={product?.reserved || 0}
                  max="1000000"
                  required
                  defaultValue={product?.stock || 0}
                />
              </label>
              <label className="f">
                Masa (g)
                <input
                  name="weightGrams"
                  type="number"
                  min="0"
                  max="1000000"
                  required
                  defaultValue={product?.weight_grams || 0}
                />
              </label>
            </div>
            <p className="muted">
              Zarezerwowane: {product?.reserved || 0} szt. Stan całkowity
              obejmuje rezerwacje.
            </p>
            <label className="f">
              Status
              <select name="status" defaultValue={product?.status || "draft"}>
                <option value="draft">Szkic</option>
                <option value="active">Aktywny</option>
                <option value="archived">Archiwum — ukryty w sklepie</option>
              </select>
            </label>
            <label className="f">
              Sposób sprzedaży
              <select
                name="saleMode"
                defaultValue={product?.sale_mode || "retail"}
              >
                <option value="retail">Sprzedaż w sklepie</option>
                <option value="inquiry">Zapytanie o produkt</option>
              </select>
            </label>
            <fieldset className="category-checks">
              <legend>Kategorie</legend>
              {categories.map((c) => (
                <label className="check-label" key={c.id}>
                  <input
                    type="checkbox"
                    name="categoryIds"
                    value={c.id}
                    defaultChecked={product?.categoryIds.includes(c.id)}
                  />
                  {c.name}
                </label>
              ))}
            </fieldset>
          </section>
          <section className="panel">
            <h3>Zdjęcia produktu</h3>
            <p>
              Pierwsze zdjęcie jest zdjęciem głównym. Usunięcie z galerii
              zachowuje plik w bibliotece.
            </p>
            <div className="media-editor">
              {media.map((m, i) => (
                <div key={m.id}>
                  <img src={m.path} alt={m.alt} />
                  <div>
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      aria-label={`Przesuń zdjęcie ${i + 1} wcześniej`}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      disabled={i === media.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={`Przesuń zdjęcie ${i + 1} dalej`}
                    >
                      →
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setMedia((list) => list.filter((x) => x.id !== m.id))
                      }
                    >
                      Odłącz
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <label className="f">
              Dodaj zdjęcie (do 15 MB)
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                disabled={uploading || media.length >= 50}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = "";
                }}
              />
            </label>
            {uploading && <p role="status">Przesyłanie zdjęcia…</p>}
            <MediaPicker
              productId={product?.id}
              selected={media.map((m) => m.id)}
              onSelect={(m) =>
                setMedia((list) =>
                  list.some((x) => x.id === m.id) || list.length >= 50
                    ? list
                    : [...list, m],
                )
              }
            />
            <label className="f">
              Opis zdjęcia głównego
              <input
                name="imageAlt"
                defaultValue={product?.image_alt}
                maxLength={300}
              />
            </label>
          </section>
        </div>
      </div>
      <section className="panel">
        <h3>Dokumenty produktu</h3>
        <p>
          Dodaj karty techniczne i dokumenty bezpieczeństwa. Materiały ze starej
          strony zachowują oznaczenie archiwalne, dopóki nie sprawdzisz
          aktualności dla sprzedawanego produktu.
        </p>
        {documents.map((d, index) => (
          <div className="product-document-editor" key={d.mediaId}>
            <a href={d.path} target="_blank" rel="noopener noreferrer">
              Otwórz dokument
            </a>
            <label className="f">
              Tytuł dokumentu
              <input
                required
                maxLength={180}
                value={d.label}
                onChange={(e) =>
                  setDocuments((list) =>
                    list.map((item, i) =>
                      i === index ? { ...item, label: e.target.value } : item,
                    ),
                  )
                }
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={d.archival}
                onChange={(e) =>
                  setDocuments((list) =>
                    list.map((item, i) =>
                      i === index
                        ? { ...item, archival: e.target.checked }
                        : item,
                    ),
                  )
                }
              />
              Dokument archiwalny
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="text-button"
                disabled={index === 0}
                onClick={() =>
                  setDocuments((list) => {
                    const next = [...list];
                    [next[index - 1], next[index]] = [
                      next[index],
                      next[index - 1],
                    ];
                    return next;
                  })
                }
              >
                Przesuń wyżej
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setDocuments((list) => list.filter((_, i) => i !== index))
                }
              >
                Odepnij od produktu
              </button>
            </div>
          </div>
        ))}
        <label className="f">
          Wgraj PDF
          <input
            type="file"
            accept="application/pdf"
            disabled={uploading || documents.length >= 30}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file, true);
              e.target.value = "";
            }}
          />
        </label>
        {documents.length < 30 && (
          <MediaPicker
            kind="document"
            scope="site"
            selected={documents.map((d) => d.mediaId)}
            onSelect={(m) =>
              setDocuments((list) => [
                ...list,
                {
                  mediaId: m.id,
                  path: m.path,
                  label: m.alt || m.path.split("/").pop() || "Dokument",
                  archival: false,
                },
              ])
            }
          />
        )}
      </section>
      <div className="admin-save">
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
        <button className="btn btn-primary" disabled={busy || uploading}>
          {busy ? "Zapisywanie…" : "Zapisz produkt"}
        </button>
        {product && (
          <Link href={`/produkt/${product.slug}`}>Podgląd produktu</Link>
        )}
      </div>
    </form>
  );
}
