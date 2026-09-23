"use client";
import { useState, useId } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Mark } from "@tiptap/core";
const Superscript = Mark.create({
  name: "superscript",
  parseHTML: () => [{ tag: "sup" }],
  renderHTML: () => ["sup", 0],
});
const Subscript = Mark.create({
  name: "subscript",
  parseHTML: () => [{ tag: "sub" }],
  renderHTML: () => ["sub", 0],
});
export function RichTextEditor({
  name,
  label,
  initial = "",
  maxLength = 100000,
  onChange,
}: {
  name: string;
  label: string;
  initial?: string;
  maxLength?: number;
  onChange?: (html: string) => void;
}) {
  const id = useId();
  const [html, setHtml] = useState(initial),
    [link, setLink] = useState(""),
    [image, setImage] = useState(""),
    [error, setError] = useState("");
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: { openOnClick: false },
        codeBlock: false,
      }),
      Image.configure({ inline: true, allowBase64: false }),
      TableKit,
      Superscript,
      Subscript,
    ],
    content: initial,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": id,
      },
    },
    onUpdate: ({ editor }) => {
      setHtml(editor.getHTML());
      onChange?.(editor.getHTML());
    },
  });
  const validUrl = (url: string) =>
    /^(https?:\/\/|mailto:|tel:|\/(?![\/\\]))/i.test(url);
  return (
    <div className="rich-editor">
      <span id={id} className="rich-label">
        {label}
      </span>
      <input type="hidden" name={name} value={html} />
      {editor && (
        <>
          <div
            className="rich-toolbar"
            role="toolbar"
            aria-label={`Formatowanie: ${label}`}
          >
            <button
              type="button"
              aria-pressed={editor.isActive("bold")}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              Pogrubienie
            </button>
            <button
              type="button"
              aria-pressed={editor.isActive("italic")}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              Kursywa
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().setParagraph().run()}
            >
              Akapit
            </button>
            <button
              type="button"
              aria-pressed={editor.isActive("heading", { level: 2 })}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
            >
              Nagłówek
            </button>
            <button
              type="button"
              aria-pressed={editor.isActive("bulletList")}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              Lista
            </button>
            <button
              type="button"
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
                  .run()
              }
            >
              Tabela
            </button>
            <button
              type="button"
              disabled={!editor.can().undo()}
              onClick={() => editor.chain().focus().undo().run()}
            >
              Cofnij
            </button>
            <button
              type="button"
              disabled={!editor.can().redo()}
              onClick={() => editor.chain().focus().redo().run()}
            >
              Ponów
            </button>
          </div>
          <EditorContent editor={editor} />
          {editor.isActive("table") && (
            <div className="rich-toolbar">
              <button
                type="button"
                onClick={() => editor.chain().focus().addRowAfter().run()}
              >
                Dodaj wiersz
              </button>
              <button
                type="button"
                onClick={() => editor.chain().focus().addColumnAfter().run()}
              >
                Dodaj kolumnę
              </button>
              <button
                type="button"
                onClick={() => editor.chain().focus().deleteRow().run()}
              >
                Usuń wiersz
              </button>
              <button
                type="button"
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                Usuń tabelę
              </button>
            </div>
          )}
          <details>
            <summary>Link lub dokument</summary>
            <p>
              Zaznacz tekst, a następnie wklej adres strony lub dokumentu z
              biblioteki plików.
            </p>
            <div className="admin-search">
              <input
                aria-label={`Adres odnośnika: ${label}`}
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https:// lub /media/..."
              />
              <button
                type="button"
                onClick={() => {
                  if (!validUrl(link)) {
                    setError("Wpisz poprawny adres odnośnika.");
                    return;
                  }
                  editor
                    .chain()
                    .focus()
                    .extendMarkRange("link")
                    .setLink({ href: link })
                    .run();
                  setError("");
                }}
              >
                Dodaj link
              </button>
              <button
                type="button"
                onClick={() => editor.chain().focus().unsetLink().run()}
              >
                Usuń link
              </button>
            </div>
          </details>
          <details>
            <summary>Zdjęcie w treści</summary>
            <div className="admin-search">
              <input
                aria-label={`Adres zdjęcia: ${label}`}
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="/media/..."
              />
              <button
                type="button"
                onClick={() => {
                  if (!image.startsWith("/media/") || /[\\\n\r]/.test(image)) {
                    setError(
                      "Wklej adres zdjęcia z biblioteki plików, zaczynający się od /media/.",
                    );
                    return;
                  }
                  editor
                    .chain()
                    .focus()
                    .setImage({ src: image, alt: "" })
                    .run();
                  setError("");
                }}
              >
                Dodaj zdjęcie
              </button>
            </div>
          </details>
        </>
      )}
      {html.length > maxLength && (
        <p className="form-error">
          Treść jest zbyt długa. Skróć ją przed zapisem.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <details>
        <summary>Zaawansowane: kod HTML</summary>
        <textarea
          aria-label={`HTML: ${label}`}
          value={html}
          maxLength={maxLength}
          rows={8}
          onChange={(e) => {
            setHtml(e.target.value);
            onChange?.(e.target.value);
            editor?.commands.setContent(e.target.value, { emitUpdate: false });
          }}
        />
      </details>
    </div>
  );
}
