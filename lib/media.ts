/** Public image helpers. Derivatives are produced by the /media route on demand. */
export const mediaWidths = [160, 320, 480, 640, 960, 1280] as const;
export type MediaWidth = (typeof mediaWidths)[number];
/** Historical built-in names remain readable without rewriting stored CMS data. */
const builtInAliases = new Map([
  ["/hero-olej.png", "/hero-olej.webp"],
  ["/tlo-silnik.png", "/tlo-silnik.webp"],
  ["/img/rp-hps-5w30-hd.png", "/img/rp-hps-5w30-hd.webp"],
]);
export function builtInMediaPath(path: string) {
  return builtInAliases.get(path) || path;
}

function resizable(path: string) {
  return (
    path.startsWith("/media/") &&
    /\.(?:jpe?g|png|webp|avif|gif)$/i.test(path) &&
    !path.includes("?")
  );
}
export function mediaSrc(path: string, width: MediaWidth) {
  return resizable(path) ? `${path}?w=${width}` : path;
}
export function mediaSrcSet(path: string, widths: readonly MediaWidth[]) {
  if (!resizable(path)) return undefined;
  return widths.map((w) => `${path}?w=${w} ${w}w`).join(", ");
}
