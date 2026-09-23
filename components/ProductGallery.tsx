"use client";
import { useState, useRef } from "react";
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
    <div>
      <button
        className="pdp-photo gallery-main"
        type="button"
        aria-label="Powiększ zdjęcie produktu"
        onClick={() => dialog.current?.showModal()}
      >
        <img src={current.path} alt={current.alt || name} />
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
              <img src={image.path} alt={image.alt || name} />
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
        <img src={current.path} alt={current.alt || name} />
      </dialog>
    </div>
  );
}
