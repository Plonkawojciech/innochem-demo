"use client";
import { useEffect, useRef, useState } from "react";
import { mediaSrc, mediaSrcSet } from "@/lib/media";
export function ProductGallery({
  images,
  name,
}: {
  images: { path: string; alt: string }[];
  name: string;
}) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const current = images[index];
  const many = images.length > 1;
  const step = (delta: number) =>
    setIndex((i) => (i + delta + images.length) % images.length);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  if (!current)
    return (
      <div className="pdp-photo">
        <div className="no-photo">
          <strong>{name}</strong>
          <span>Zdjęcie produktu w przygotowaniu</span>
        </div>
      </div>
    );
  return (
    <div className="gallery">
      <button
        className="pdp-photo gallery-main"
        type="button"
        aria-label="Powiększ zdjęcie produktu"
        onClick={() => setOpen(true)}
      >
        <img
          src={mediaSrc(current.path, 960)}
          srcSet={mediaSrcSet(current.path, [480, 640, 960, 1280])}
          sizes="(max-width: 900px) 92vw, 540px"
          alt={current.alt || name}
          width={960}
          height={960}
          decoding="async"
          fetchPriority="high"
        />
        <span className="zoom-hint" aria-hidden>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5M8 11h6M11 8v6" />
          </svg>
        </span>
      </button>
      {many && (
        <div className="gallery-thumbs" aria-label="Zdjęcia produktu">
          {images.map((image, i) => (
            <button
              type="button"
              key={image.path}
              aria-label={`Zdjęcie ${i + 1}`}
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
            >
              <img
                src={mediaSrc(image.path, 160)}
                alt={image.alt || name}
                width={72}
                height={72}
                loading="lazy"
                decoding="async"
              />
            </button>
          ))}
        </div>
      )}
      <dialog
        ref={dialog}
        className="lightbox"
        aria-label={`Zdjęcie: ${current.alt || name}`}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" && many) step(1);
          if (e.key === "ArrowLeft" && many) step(-1);
        }}
      >
        <div className="lightbox-bar">
          <span>
            {name}
            {many && (
              <small>
                {" "}
                · {index + 1} / {images.length}
              </small>
            )}
          </span>
          <button
            type="button"
            className="lightbox-close"
            aria-label="Zamknij"
            autoFocus
            onClick={() => setOpen(false)}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div
          className="lightbox-stage"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          {many && (
            <button
              type="button"
              className="lightbox-nav prev"
              aria-label="Poprzednie zdjęcie"
              onClick={() => step(-1)}
            >
              ‹
            </button>
          )}
          <img
            key={current.path}
            src={mediaSrc(current.path, 1280)}
            alt={current.alt || name}
            decoding="async"
          />
          {many && (
            <button
              type="button"
              className="lightbox-nav next"
              aria-label="Następne zdjęcie"
              onClick={() => step(1)}
            >
              ›
            </button>
          )}
        </div>
        {many && (
          <div className="lightbox-thumbs">
            {images.map((image, i) => (
              <button
                type="button"
                key={image.path}
                aria-label={`Zdjęcie ${i + 1}`}
                aria-pressed={i === index}
                onClick={() => setIndex(i)}
              >
                <img
                  src={mediaSrc(image.path, 160)}
                  alt=""
                  width={56}
                  height={56}
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        )}
      </dialog>
    </div>
  );
}
