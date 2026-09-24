"use client";
import { useState, useRef } from "react";
import { mediaSrc, mediaSrcSet } from "@/lib/media";
export function ProductGallery({
  images,
  name,
}: {
  images: { path: string; alt: string }[];
  name: string;
}) {
  const [index, setIndex] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const current = images[index];
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
        onClick={() => dialog.current?.showModal()}
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
        <span className="zoom-hint">Powiększ</span>
      </button>
      {images.length > 1 && (
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
        className="gallery-dialog"
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        <button
          type="button"
          className="btn btn-outline"
          autoFocus
          onClick={() => dialog.current?.close()}
        >
          Zamknij zdjęcie
        </button>
        <img
          src={mediaSrc(current.path, 1280)}
          alt={current.alt || name}
          loading="lazy"
          decoding="async"
        />
      </dialog>
    </div>
  );
}
