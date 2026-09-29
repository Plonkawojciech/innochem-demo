export type Consent = { v: 1; analytics: boolean; at: string };
export const CONSENT_KEY = "innochem-consent";
const REVOKE_PENDING = "innochem-consent-revoke-pending";
export const CONSENT_CHANGED = "innochem-consent-changed";
export const PRIVACY_OPEN = "innochem-privacy-open";
export const measurementId = () =>
  process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID?.trim() || "";
export function parseConsent(raw: string | null): Consent | null {
  try {
    const c = JSON.parse(raw || "null");
    if (
      c?.v !== 1 ||
      typeof c.analytics !== "boolean" ||
      typeof c.at !== "string"
    )
      return null;
    const at = new Date(c.at);
    const expires = new Date(at);
    expires.setUTCMonth(expires.getUTCMonth() + 6);
    return Number.isFinite(at.getTime()) &&
      at.getTime() <= Date.now() &&
      expires.getTime() > Date.now()
      ? c
      : null;
  } catch {
    return null;
  }
}
export function readCookie(name: string) {
  if (typeof document === "undefined") return null;
  const raw = document.cookie
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  try {
    return raw ? decodeURIComponent(raw) : null;
  } catch {
    return null;
  }
}
export function readConsent() {
  // Cookie is authoritative: deleting/expiring it never resurrects localStorage consent.
  return parseConsent(readCookie(CONSENT_KEY));
}
export function hasAnalyticsConsent() {
  return !!measurementId() && readConsent()?.analytics === true;
}
export function clearGoogleCookies() {
  const names = document.cookie
    .split(";")
    .map((x) => x.trim().split("=")[0])
    .filter((n) => n.startsWith("_ga"));
  const parts = location.hostname.split(".");
  const domains = ["", ...parts.map((_, i) => parts.slice(i).join("."))];
  for (const name of names)
    for (const domain of domains) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain ? `; domain=${domain}` : ""}`;
    }
}
function persist(c: Consent) {
  const expires = new Date(c.at);
  expires.setUTCMonth(expires.getUTCMonth() + 6);
  document.cookie = `${CONSENT_KEY}=${encodeURIComponent(JSON.stringify(c))}; expires=${expires.toUTCString()}; path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(c));
  } catch {}
  window.dispatchEvent(new Event(CONSENT_CHANGED));
}
let saving = false;
let retrying: Promise<void> | null = null;
async function sendDecision(c: Consent) {
  const response = await fetch("/api/analytics/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(c),
  });
  if (!response.ok)
    throw new Error(
      "Nie udało się zapisać ustawień na serwerze. Spróbuj ponownie. Statystyka jest wyłączona w tej przeglądarce; wycofanie na serwerze wymaga ponowienia.",
    );
}
export async function retryRevocation() {
  if (saving) return;
  if (retrying) return retrying;
  let pending = false;
  try {
    pending = localStorage.getItem(REVOKE_PENDING) === "1";
  } catch {}
  if (!pending) return;
  retrying = sendDecision({
    v: 1,
    analytics: false,
    at: new Date().toISOString(),
  })
    .then(() => {
      try {
        localStorage.removeItem(REVOKE_PENDING);
      } catch {}
    })
    .finally(() => {
      retrying = null;
    });
  return retrying;
}
export async function saveConsent(analytics: boolean) {
  const c: Consent = {
    v: 1,
    analytics: analytics && !!measurementId(),
    at: new Date().toISOString(),
  };
  // Fail closed, including re-saving an existing grant. Retry revocation after reload/offline.
  if (retrying) await retrying;
  saving = true;
  try {
    // Other tabs must not race a grant by retrying this same pending revocation.
    try {
      localStorage.removeItem(REVOKE_PENDING);
    } catch {}
    persist({ ...c, analytics: false });
    clearGoogleCookies();
    await sendDecision(c);
    if (c.analytics) persist(c);
  } catch (error) {
    try {
      localStorage.setItem(REVOKE_PENDING, "1");
    } catch {}
    throw error;
  } finally {
    saving = false;
  }
  return c;
}
export function analyticsIdentity() {
  const c = readConsent();
  if (!hasAnalyticsConsent() || !c) return null;
  const client =
    readCookie("_ga")?.match(/^GA\d+\.\d+\.(\d{1,20}\.\d{1,20})$/)?.[1] || null;
  const session = readCookie(`_ga_${measurementId().replace(/^G-/, "")}`) || "";
  const sessionId =
    session.match(/^GS1\.\d+\.([1-9]\d{0,14})\./)?.[1] ||
    session.match(/^GS2\.\d+\.s([1-9]\d{0,14})(?:\$|$)/)?.[1] ||
    null;
  return { client_id: client, session_id: sessionId, v: c.v, at: c.at };
}
