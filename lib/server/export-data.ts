const privateKeys = new Set([
  "password",
  "passwd",
  "securekey",
  "postpassword",
  "downloadhash",
  "accesshash",
  "idempotencykey",
  "requesthash",
  "eventkey",
  "token",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "verificationtoken",
  "resettoken",
  "apikey",
  "secret",
  "secretkey",
  "webhooksecret",
  "authorization",
  "cookie",
  "request",
]);

/** Exports belong to the shop owner; authentication and integration credentials do not. */
export function publicExportData(value: unknown): unknown {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(publicExportData);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) => !privateKeys.has(key.replace(/[_-]/g, "").toLowerCase()),
        )
        .map(([key, item]) => [key, publicExportData(item)]),
    );
  return value;
}

export function fulfillmentExport(row: Record<string, unknown>) {
  const buyer = (row.buyer || {}) as Record<string, unknown>;
  const address = (row.shipping_address || {}) as Record<string, unknown>;
  return {
    ...row,
    first_name: buyer.firstName || address.firstName || "",
    last_name: buyer.lastName || address.lastName || "",
    phone: buyer.phone || address.phone || "",
    company: buyer.company || address.company || "",
    nip: buyer.nip || address.nip || "",
    street: address.street || "",
    postal_code: address.postalCode || "",
    city: address.city || "",
    country: address.country || "",
    cod_cents: row.payment_method === "cod" ? row.total_cents : 0,
  };
}
