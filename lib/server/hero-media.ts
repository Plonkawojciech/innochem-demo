import { createHash } from "node:crypto";
import type { SiteContent } from "../site-content";

type HeroGeometry = Pick<
  SiteContent["home"]["hero"],
  "label" | "title" | "text" | "image" | "link" | "secondary"
>;
/** The crops were verified against this layout. CMS edits retain the full image. */
export function canCropHero(
  hero: HeroGeometry,
  benefits: SiteContent["home"]["benefits"],
) {
  const geometry = JSON.stringify([
    hero.label,
    hero.title,
    hero.text,
    hero.image.path,
    hero.link.name,
    hero.secondary.name,
    benefits.map((b) => [b.title, b.text]),
  ]);
  return (
    createHash("sha256").update(geometry).digest("hex") ===
    "32b65505e19d34b573dab467489d601e2c85e12f991d4edfb03ee0780ef669fe"
  );
}
