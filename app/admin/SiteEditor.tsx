"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  defaultSiteContent,
  siteContentSchema,
  type SiteContent,
  type SiteImage,
} from "@/lib/site-content";
import { MediaPicker } from "./MediaPicker";
import { RichTextEditor } from "./RichTextEditor";

type Product = { id: string; name: string };
type Value = string | boolean | null | Value[] | { [key: string]: Value };
const labels: Record<string, string> = {
  brand: "Marka i stopka",
  contact: "Dane kontaktowe",
  seo: "Wygląd w wyszukiwarkach i udostępnianie",
  navigation: "Menu",
  footer: "Kolumny stopki",
  home: "Strona główna",
  contactPage: "Strona kontaktowa",
  industryPage: "Oferta dla przemysłu",
  distributorsPage: "Współpraca i dystrybucja",
  hero: "Pierwsza sekcja",
  benefits: "Informacje pod pierwszą sekcją",
  categories: "Kategorie",
  technology: "Technologia",
  featured: "Wyróżniony produkt",
  name: "Nazwa",
  tagline: "Dopisek pod logo",
  logo: "Logo",
  footerText: "Opis w stopce",
  copyright: "Dopisek przy prawach autorskich",
  company: "Pełna nazwa firmy",
  email: "E-mail kontaktowy",
  phone: "Telefon",
  address: "Adres",
  hours: "Godziny pracy",
  nip: "NIP",
  regon: "REGON",
  title: "Tytuł",
  description: "Opis",
  image: "Zdjęcie",
  path: "Plik",
  alt: "Opis zdjęcia",
  main: "Główne menu",
  highlighted: "Wyróżniony odnośnik",
  items: "Elementy",
  links: "Odnośniki",
  href: "Adres odnośnika",
  enabled: "Widoczna sekcja",
  label: "Nadtytuł",
  text: "Treść",
  productId: "Produkt z katalogu",
  link: "Główny przycisk",
  secondary: "Drugi przycisk",
  background: "Zdjęcie w tle",
  bodyHtml: "Treść strony",
  metaDescription: "Opis dla wyszukiwarki",
  subject: "Domyślny temat formularza",
  departments: "Działy przemysłowe",
  key: "Adres działu (np. hydraulika)",
};
const titleFor = (path: string) =>
  labels[path.split(".").at(-1) || ""] || "Element";
function arrayTemplate(path: string): Value {
  if (path === "footer") return { title: "Nowa kolumna", links: [] };
  if (path === "navigation.categories")
    return { name: "Nowa kategoria", href: "/katalog", items: [] };
  if (path === "home.categories.items")
    return { name: "Nowa kategoria", href: "/katalog", description: "" };
  if (path === "home.benefits" || path === "home.technology.items")
    return { title: "Nowy element", text: "" };
  if (path.endsWith("departments"))
    return { key: "nowy-dzial", name: "Nowy dział" };
  return { name: "Nowy odnośnik", href: "/" };
}
const limits: Record<string, number> = {
  footer: 5,
  "navigation.main": 10,
  "navigation.categories": 12,
  "home.benefits": 8,
  "home.technology.items": 8,
  "industryPage.departments": 20,
};
function ImageField({
  value,
  onChange,
  label,
}: {
  value: SiteImage;
  onChange: (v: Value) => void;
  label: string;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <fieldset className="site-image-field">
      <legend>{label}</legend>
      {value.path && (
        <img src={value.path} alt={value.alt || "Wybrane zdjęcie"} />
      )}
      <label className="f">
        Opis zdjęcia
        <input
          value={value.alt}
          maxLength={300}
          onChange={(e) => onChange({ ...value, alt: e.target.value })}
        />
      </label>
      <MediaPicker
        scope="site"
        selected={[]}
        onSelect={(m) => onChange({ path: m.path, alt: m.alt || value.alt })}
      />
      <label className="f">
        Prześlij nowe zdjęcie
        <input
          type="file"
          disabled={busy}
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError("");
            try {
              const r = await fetch("/api/admin/upload", {
                method: "POST",
                headers: { "Content-Type": "application/octet-stream" },
                body: file,
              });
              const d = await r.json();
              if (!r.ok || !d.mime_type?.startsWith("image/"))
                throw new Error(d.error || "Wybierz zdjęcie.");
              onChange({ path: d.path, alt: value.alt });
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "Nie udało się przesłać zdjęcia.",
              );
            } finally {
              setBusy(false);
              e.target.value = "";
            }
          }}
        />
      </label>
      {busy && <p role="status">Przesyłanie…</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {value.path && (
        <button
          type="button"
          className="text-button"
          onClick={() => onChange({ path: "", alt: "" })}
        >
          Usuń zdjęcie z tej sekcji
        </button>
      )}
    </fieldset>
  );
}
function Field({
  path,
  value,
  onChange,
  products,
}: {
  path: string;
  value: Value;
  onChange: (v: Value) => void;
  products: Product[];
}) {
  const key = path.split(".").at(-1)!,
    label = titleFor(path);
  if (key === "productId")
    return (
      <label className="f">
        {label}
        <select
          value={String(value || "")}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">Własne zdjęcie i odnośnik</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <small>
          Wybrany produkt automatycznie dostarcza zdjęcie i aktualny adres
          karty. Tekst sekcji edytujesz poniżej.
        </small>
      </label>
    );
  if (typeof value === "boolean")
    return (
      <label className="check-label">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
    );
  if (typeof value === "string") {
    if (key === "bodyHtml")
      return (
        <RichTextEditor
          name={path}
          label={label}
          initial={value}
          maxLength={50000}
          onChange={onChange}
        />
      );
    const multiline = [
      "text",
      "description",
      "address",
      "footerText",
      "metaDescription",
    ].includes(key);
    return (
      <label className="f">
        {label}
        {multiline ? (
          <textarea
            value={value}
            rows={3}
            maxLength={key === "metaDescription" ? 320 : 2000}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            value={value}
            maxLength={key === "href" ? 500 : 2000}
            type={key === "email" ? "email" : "text"}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {key === "href" && (
          <small>
            Adres w sklepie, np. /katalog, albo pełny odnośnik HTTPS.
          </small>
        )}
      </label>
    );
  }
  if (Array.isArray(value))
    return (
      <div className="site-list">
        <h4>{label}</h4>
        {value.map((entry, i) => (
          <div className="site-list-item" key={i}>
            <div className="site-list-controls">
              <span>
                {label}: {i + 1}
              </span>
              <button
                type="button"
                className="text-button"
                disabled={!i}
                onClick={() => {
                  const next = [...value];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  onChange(next);
                }}
              >
                W górę
              </button>
              <button
                type="button"
                className="text-button"
                disabled={i === value.length - 1}
                onClick={() => {
                  const next = [...value];
                  [next[i + 1], next[i]] = [next[i], next[i + 1]];
                  onChange(next);
                }}
              >
                W dół
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => onChange(value.filter((_, j) => i !== j))}
              >
                Usuń element
              </button>
            </div>
            <Field
              path={`${path}.${i}`}
              value={entry}
              products={products}
              onChange={(v) =>
                onChange(value.map((old, j) => (j === i ? v : old)))
              }
            />
          </div>
        ))}
        <button
          type="button"
          className="btn btn-outline"
          disabled={value.length >= (limits[path] || 12)}
          onClick={() => onChange([...value, arrayTemplate(path)])}
        >
          Dodaj element
        </button>
      </div>
    );
  if (value && typeof value === "object") {
    if ("path" in value && "alt" in value)
      return (
        <ImageField
          label={label}
          value={value as SiteImage}
          onChange={onChange}
        />
      );
    return (
      <div className="site-fields">
        {Object.entries(value).map(([k, v]) => (
          <Field
            key={k}
            path={`${path}.${k}`}
            value={v}
            products={products}
            onChange={(next) => onChange({ ...value, [k]: next })}
          />
        ))}
      </div>
    );
  }
  return null;
}
export function SiteEditor({
  initial,
  version: initialVersion,
  products,
  revisions,
  preview,
}: {
  initial: SiteContent;
  version: number;
  products: Product[];
  revisions: { id: string; action: string; createdAt: string }[];
  preview: boolean;
}) {
  const [value, setValue] = useState(initial),
    [version, setVersion] = useState(initialVersion),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [generation, setGeneration] = useState(0),
    [confirmPublish, setConfirmPublish] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save(
    action: "draft" | "publish" | "restore",
    revisionId?: string,
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (action !== "restore") {
        const validation = siteContentSchema.safeParse(value);
        if (!validation.success)
          throw new Error(
            `Sprawdź pole: ${validation.error.issues
              .map((i) =>
                i.path
                  .map((p) =>
                    typeof p === "string"
                      ? labels[p] || p
                      : typeof p === "number"
                        ? p + 1
                        : String(p),
                  )
                  .join(" / "),
              )
              .slice(0, 4)
              .join(", ")}.`,
          );
      }
      const r = await fetch("/api/admin/site", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "restore"
            ? { action, version, revisionId }
            : { action, version, value },
        ),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setVersion(data.version);
      setValue(data.value);
      setDirty(false);
      setConfirmPublish(false);
      setGeneration((g) => g + 1);
      setMessage(
        action === "publish"
          ? "Opublikowano treść w tym sklepie."
          : action === "restore"
            ? "Wczytano wcześniejszą wersję jako szkic. Publikacja pozostaje bez zmian."
            : "Zapisano szkic. Możesz otworzyć podgląd.",
      );
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Zapis nie powiódł się.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function openPreview() {
    if (dirty || version === 0) if (!(await save("draft"))) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/site-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      if (!r.ok) throw new Error();
      router.push("/");
      router.refresh();
    } catch {
      setError("Nie udało się otworzyć podglądu.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="site-editor">
      <p>
        Edytuj teksty, zdjęcia i odnośniki. Zapis szkicu pozwala sprawdzić
        wygląd przed publikacją.{" "}
        {preview && "Pracujesz w podglądzie nowego sklepu."}
      </p>
      <div className="site-editor-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void save("draft")}
        >
          Zapisz szkic
        </button>
        <button
          type="button"
          className="btn btn-outline"
          disabled={busy}
          onClick={() => void openPreview()}
        >
          Podgląd szkicu
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => setConfirmPublish(true)}
        >
          {preview ? "Publikuj w podglądzie sklepu" : "Publikuj"}
        </button>
        <span aria-live="polite">
          {busy
            ? "Zapisywanie…"
            : dirty
              ? "Niezapisane zmiany"
              : "Szkic zapisany"}
        </span>
      </div>
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
      {confirmPublish && (
        <div className="notice">
          <p>
            Opublikować aktualne teksty i wygląd witryny
            {preview ? " w tym lokalnym podglądzie" : " dla odwiedzających"}?
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void save("publish")}
          >
            Potwierdź publikację
          </button>{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => setConfirmPublish(false)}
          >
            Wróć do edycji
          </button>
        </div>
      )}
      <fieldset disabled={busy} className="site-editor-body" key={generation}>
        {(Object.keys(defaultSiteContent) as (keyof SiteContent)[]).map(
          (section) => (
            <details key={section} className="site-editor-section">
              <summary>{titleFor(section)}</summary>
              {section === "home" ? (
                Object.entries(value.home).map(([key, entry]) => (
                  <details key={key} className="site-editor-subsection">
                    <summary>{titleFor(key)}</summary>
                    <Field
                      path={`home.${key}`}
                      value={entry as Value}
                      products={products}
                      onChange={(next) => {
                        setValue(
                          (v) =>
                            ({
                              ...v,
                              home: { ...v.home, [key]: next },
                            }) as SiteContent,
                        );
                        setDirty(true);
                        setMessage("");
                      }}
                    />
                  </details>
                ))
              ) : (
                <Field
                  path={section}
                  value={value[section] as Value}
                  products={products}
                  onChange={(next) => {
                    setValue((v) => ({ ...v, [section]: next }) as SiteContent);
                    setDirty(true);
                    setMessage("");
                  }}
                />
              )}
            </details>
          ),
        )}
      </fieldset>
      <details className="site-editor-section">
        <summary>Wcześniejsze zapisy ({revisions.length})</summary>
        <p>
          Przywrócenie zastępuje szkic. Treść widoczna dla odwiedzających
          zmienia się dopiero po publikacji.
        </p>
        {revisions.map((r) => (
          <div className="site-revision" key={r.id}>
            <span>
              {new Date(r.createdAt).toLocaleString("pl-PL")} ·{" "}
              {r.action === "publish"
                ? "Publikacja"
                : r.action === "restore"
                  ? "Przywrócenie"
                  : "Szkic"}
            </span>
            <button
              type="button"
              className="text-button"
              disabled={busy || dirty}
              onClick={() => void save("restore", r.id)}
            >
              Przywróć do szkicu
            </button>
          </div>
        ))}
        {dirty && <p>Zapisz zmiany przed wczytaniem wcześniejszej wersji.</p>}
      </details>
    </div>
  );
}
