/** Only select AVIF when the client explicitly accepts it at least as much as WebP. */
export function derivativeFormat(accept: string | null): "avif" | "webp" {
  const qualities = new Map<string, number>();
  for (const entry of (accept || "").toLowerCase().split(",")) {
    const [mime, ...parameters] = entry.trim().split(";");
    const quality = parameters.find((p) => p.trim().startsWith("q="));
    const q = quality ? Number(quality.trim().slice(2)) : 1;
    if (Number.isFinite(q) && q >= 0 && q <= 1) qualities.set(mime.trim(), q);
  }
  const avif = qualities.get("image/avif") || 0;
  return avif > 0 && avif >= (qualities.get("image/webp") ?? 0)
    ? "avif"
    : "webp";
}
