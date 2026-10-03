export const checkoutStorageKey = "innochem-checkout-key";
export type CheckoutKey = { key: string; fingerprint: string };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export function checkoutFingerprint(data: {
  cart: Record<string, number>;
  shippingMethod: string;
  paymentMethod: string;
  totalCents: number;
  termsVersion: string;
}) {
  const text = JSON.stringify({
    ...data,
    cart: Object.entries(data.cart).sort(([a], [b]) => a.localeCompare(b)),
  });
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function resolveCheckoutKey(
  storage: Storage | undefined,
  fingerprint: string,
  current: CheckoutKey | null,
  generate: () => string = () => crypto.randomUUID(),
): CheckoutKey {
  if (current?.fingerprint === fingerprint) return current;
  try {
    const saved: unknown = JSON.parse(
      storage?.getItem(checkoutStorageKey) || "null",
    );
    if (
      saved &&
      typeof saved === "object" &&
      "fingerprint" in saved &&
      saved.fingerprint === fingerprint &&
      "key" in saved &&
      typeof saved.key === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        saved.key,
      )
    )
      return { key: saved.key, fingerprint };
  } catch {
    /* Storage can be blocked or contain invalid JSON. */
  }
  const next = { key: generate(), fingerprint };
  try {
    storage?.setItem(checkoutStorageKey, JSON.stringify(next));
  } catch {
    /* Retain the in-memory key. */
  }
  return next;
}

export function clearCheckoutKey(storage: Storage | undefined) {
  try {
    storage?.removeItem(checkoutStorageKey);
  } catch {
    /* Storage may be blocked. */
  }
}
