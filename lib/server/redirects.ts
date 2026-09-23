import { query } from "./db";

export type RedirectResult = {
  status: 301 | 308 | 410 | 404;
  destination: string | null;
};
const origin = "https://innochem.invalid";
export function safeDestination(value: string): boolean {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\x00-\x20]/.test(value)
  )
    return false;
  try {
    return new URL(value, origin).origin === origin;
  } catch {
    return false;
  }
}
function pathOf(url: URL) {
  try {
    return decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}
/** Ignore tracking and pagination only on known legacy routes; never replay legacy tokens. */
export function redirectKey(
  url: URL,
): { key: string; legacyIdentity: boolean } | null {
  let path = pathOf(url);
  if (!path || path.length > 2000 || /[\\\x00-\x1f]/.test(path)) return null;
  if (
    path === "/index.php" &&
    ["p", "page_id", "cat"].some((k) => url.searchParams.has(k))
  )
    path = "/";
  const identifiers =
    path === "/"
      ? ["p", "page_id", "cat"]
      : path === "/sklep/product.php"
        ? ["id_product"]
        : path === "/sklep/category.php"
          ? ["id_category"]
          : path === "/sklep/cms.php"
            ? ["id_cms"]
            : [];
  if (identifiers.length) {
    const present = identifiers.filter((k) => url.searchParams.has(k));
    if (present.length) {
      if (
        present.length !== 1 ||
        url.searchParams.getAll(present[0]).length !== 1
      )
        return null;
      const value = url.searchParams.get(present[0])!;
      if (!/^[1-9]\d{0,8}$/.test(value)) return null;
      return { key: `${path}?${present[0]}=${value}`, legacyIdentity: true };
    }
  }
  // WordPress archive pagination is represented by its archive, not a new shop page number.
  path = path.replace(/\/page\/[1-9]\d*$/, "");
  return {
    key: path,
    legacyIdentity: /\.php$/.test(path) && path.startsWith("/sklep/"),
  };
}
export async function resolveRedirect(
  url: URL,
): Promise<RedirectResult | null> {
  const identity = redirectKey(url);
  if (!identity) return { status: 404, destination: null };
  let key = identity.key,
    destination: string | null = null;
  const seen = new Set<string>();
  for (let n = 0; n < 8; n++) {
    if (seen.has(key)) return { status: 404, destination: null };
    seen.add(key);
    const {
      rows: [row],
    } = await query<{
      destination_path: string | null;
      status: 301 | 308 | 410;
    }>(
      "SELECT destination_path,status FROM redirects WHERE source_path=$1 AND active",
      [key],
    );
    if (!row) {
      if (destination) return { status: 301, destination };
      return identity.legacyIdentity
        ? { status: 404, destination: null }
        : null;
    }
    if (row.status === 410) return { status: 410, destination: null };
    if (!row.destination_path || !safeDestination(row.destination_path))
      return { status: 404, destination: null };
    destination = row.destination_path;
    const next = redirectKey(new URL(destination, origin));
    if (!next) return { status: 404, destination: null };
    key = next.key;
  }
  return { status: 404, destination: null };
}
