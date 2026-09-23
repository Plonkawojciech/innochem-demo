"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RichTextEditor } from "./RichTextEditor";
type Values = Record<string, string | number | boolean | null>;
function Editor({
  resource,
  id,
  version,
  children,
  readBody,
}: {
  resource: string;
  id?: string;
  version?: number;
  children: ReactNode;
  readBody: (f: FormData) => unknown;
}) {
  const router = useRouter();
  const [currentVersion, setVersion] = useState(version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch(`/api/admin/${resource}${id ? `/${id}` : ""}`, {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: currentVersion,
          ...(readBody(new FormData(e.currentTarget)) as object),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setVersion(d.version);
      setMessage("Zapisano zmiany.");
      if (!id && resource === "pages") router.push(`/admin/tresci/${d.id}`);
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Zapis nie powiódł się.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="entity-editor">
      {children}
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
        {busy ? "Zapisywanie…" : "Zapisz"}
      </button>
    </form>
  );
}
const s = (f: FormData, k: string) => String(f.get(k) || "");
export function CategoryEditor({
  category,
  categories,
}: {
  category?: Values;
  categories: { id: string; name: string }[];
}) {
  return (
    <Editor
      resource="categories"
      id={category?.id as string | undefined}
      version={category?.version as number | undefined}
      readBody={(f) => ({
        name: s(f, "name"),
        slug: s(f, "slug"),
        parentId: s(f, "parentId") || null,
        descriptionHtml: s(f, "descriptionHtml"),
        position: Number(f.get("position")),
        visible: f.get("visible") === "on",
      })}
    >
      <div className="field-grid">
        <label className="f">
          Nazwa
          <input
            name="name"
            defaultValue={String(category?.name || "")}
            required
            maxLength={180}
          />
        </label>
        <label className="f">
          Adres kategorii
          <input
            name="slug"
            defaultValue={String(category?.slug || "")}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={180}
          />
        </label>
      </div>
      <div className="field-grid">
        <label className="f">
          Kategoria nadrzędna
          <select
            name="parentId"
            defaultValue={String(category?.parent_id || "")}
          >
            <option value="">Brak</option>
            {categories
              .filter((c) => c.id !== category?.id)
              .map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="f">
          Kolejność
          <input
            name="position"
            type="number"
            min="0"
            max="10000"
            defaultValue={Number(category?.position || 0)}
            required
          />
        </label>
      </div>
      <RichTextEditor
        name="descriptionHtml"
        label="Opis kategorii"
        initial={String(category?.description_html || "")}
        maxLength={30000}
      />
      <label className="check-label">
        <input
          name="visible"
          type="checkbox"
          defaultChecked={category ? !!category.visible : true}
        />
        Widoczna w sklepie
      </label>
    </Editor>
  );
}
export function PageEditor({ page }: { page?: Values }) {
  return (
    <Editor
      resource="pages"
      id={page?.id as string | undefined}
      version={page?.version as number | undefined}
      readBody={(f) => ({
        title: s(f, "title"),
        slug: s(f, "slug"),
        bodyHtml: s(f, "bodyHtml"),
        metaDescription: s(f, "metaDescription"),
        published: f.get("published") === "on",
      })}
    >
      <label className="f">
        Tytuł
        <input
          name="title"
          defaultValue={String(page?.title || "")}
          required
          maxLength={180}
        />
      </label>
      <label className="f">
        Adres strony
        <input
          name="slug"
          defaultValue={String(page?.slug || "")}
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          maxLength={180}
        />
      </label>
      <RichTextEditor
        name="bodyHtml"
        label="Treść strony"
        initial={String(page?.body_html || "")}
        maxLength={200000}
      />
      <label className="f">
        Opis dla wyszukiwarek
        <textarea
          name="metaDescription"
          defaultValue={String(page?.meta_description || "")}
          maxLength={320}
        />
      </label>
      <label className="check-label">
        <input
          name="published"
          type="checkbox"
          defaultChecked={!!page?.published}
        />
        Opublikowana
      </label>
      <p className="muted">
        Publikacja treści nie zatwierdza automatycznie regulaminu zakupów.
      </p>
    </Editor>
  );
}
export function InquiryEditor({
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
  return (
    <Editor
      resource="inquiries"
      id={id}
      version={version}
      readBody={(f) => ({ status: s(f, "status"), internalNote: s(f, "note") })}
    >
      <label className="f">
        Status
        <select name="status" defaultValue={status}>
          <option value="new">Nowe</option>
          <option value="in_progress">W obsłudze</option>
          <option value="closed">Zamknięte</option>
        </select>
      </label>
      <label className="f">
        Notatka wewnętrzna
        <textarea name="note" defaultValue={note} maxLength={10000} rows={3} />
      </label>
      <p className="muted">
        Notatka pozostaje w panelu. Zapis nie wysyła wiadomości klientowi.
      </p>
    </Editor>
  );
}
