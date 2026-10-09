"use client";
import { PRIVACY_OPEN } from "@/lib/consent";
export function PrivacySettingsButton() {
  return (
    <button
      type="button"
      className="privacy-settings"
      onClick={() => window.dispatchEvent(new Event(PRIVACY_OPEN))}
    >
      Ustawienia prywatności
    </button>
  );
}
