import type { PoolClient } from "pg";
import { z } from "zod";
import { query, transaction } from "./db";
import { productFacts } from "../product-facts";

export const analyticsInput = z
  .object({
    client_id: z
      .string()
      .regex(/^\d{1,20}\.\d{1,20}$/)
      .nullable(),
    session_id: z
      .string()
      .regex(/^[1-9]\d{0,14}$/)
      .nullable(),
    v: z.literal(1),
    at: z.iso.datetime(),
  })
  .strict();
export const consentCookie = "innochem-consent-id";
export function consentId(request: Request) {
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${consentCookie}=`))
    ?.slice(consentCookie.length + 1);
  return z.uuid().safeParse(value).success ? value! : null;
}
export async function revokeConsent(id: string) {
  await transaction(async (db) => {
    await db.query(
      "UPDATE analytics_consents SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1",
      [id],
    );
    await db.query(
      "UPDATE orders SET ga_client_id=NULL,ga_session_id=NULL,analytics_consent_at=NULL WHERE analytics_consent_id=$1",
      [id],
    );
    await db.query(
      `UPDATE analytics_outbox SET status='skipped',last_error='no_consent',client_id=NULL,session_id=NULL
      WHERE order_id IN (SELECT id FROM orders WHERE analytics_consent_id=$1) AND status='pending'`,
      [id],
    );
  });
}
// Called inside the business transaction. No network calls from payment handlers.
export async function enqueueAnalytics(
  db: PoolClient,
  orderId: string,
  type: "purchase" | "refund" | "order_submitted",
  refund?: {
    eventKey: string;
    lines: { itemId: string; quantity: number; amountCents: number }[];
    shippingCents: number;
  },
) {
  const {
    rows: [o],
  } = await db.query(
    `SELECT o.*,c.version AS consent_version,
    c.revoked_at IS NULL AND c.expires_at>now() AS consent_valid
    FROM orders o LEFT JOIN analytics_consents c ON c.id=o.analytics_consent_id WHERE o.id=$1`,
    [orderId],
  );
  if (type === "purchase" && o.payment_method === "cod") return;
  const { rows: originalItems } = await db.query(
    "SELECT * FROM order_items WHERE order_id=$1 ORDER BY id",
    [orderId],
  );
  const items = refund
    ? refund.lines
        .filter((r) => r.quantity > 0)
        .map((r) => {
          const i = originalItems.find((i) => i.id === r.itemId);
          return { ...i, quantity: r.quantity, total_cents: r.amountCents };
        })
    : originalItems;
  const net = items.map((i) =>
    Math.round((i.total_cents * 100) / (100 + Number(i.tax_rate))),
  );
  const valueCents = net.reduce((a, b) => a + b, 0);
  const reason =
    refund && !items.length
      ? "refund_adjustment"
      : o.payment_method === "cod"
        ? "cod"
        : !o.ga_client_id || !o.analytics_consent_at || !o.consent_valid
          ? "no_consent"
          : null;
  const payload = {
    transaction_id: String(o.number),
    currency: "PLN",
    value: valueCents / 100,
    tax: (items.reduce((sum, i) => sum + i.total_cents, 0) - valueCents) / 100,
    shipping: (refund?.shippingCents ?? o.shipping_cents) / 100,
    ...(refund ? { refund_id: refund.eventKey } : {}),
    items: items.map((i, index) => ({
      item_id: i.sku || i.product_id || i.id,
      item_name: i.product_name,
      item_category: productFacts(i.product_name).series || "Inne",
      // Unit net price retains precision so quantity agrees with rounded line net.
      price: net[index] / Math.max(1, i.quantity) / 100,
      quantity: i.quantity,
    })),
  };
  await db.query(
    `INSERT INTO analytics_outbox(order_id,event_type,payload,client_id,session_id,consent_version,status,last_error,event_key)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(order_id,event_type,destination,event_key) DO NOTHING`,
    [
      orderId,
      type,
      JSON.stringify(payload),
      o.ga_client_id,
      o.ga_session_id,
      o.consent_version,
      reason ? "skipped" : "pending",
      reason,
      refund?.eventKey ?? "singleton",
    ],
  );
}

export async function deliverAnalyticsBatch(fetcher: typeof fetch = fetch) {
  const counts = { sent: 0, skipped: 0, failed: 0 };
  try {
    const { rows } =
      await query(`SELECT a.id,o.analytics_consent_id FROM analytics_outbox a JOIN orders o ON o.id=a.order_id
      WHERE a.status='pending' AND a.next_attempt_at<=now() ORDER BY a.created_at LIMIT 25`);
    for (const candidate of rows) {
      await transaction(async (db) => {
        // Same lock order as revocation; consent cannot be revoked during a send.
        const c = candidate.analytics_consent_id
          ? (
              await db.query(
                "SELECT *,expires_at>now() AS fresh FROM analytics_consents WHERE id=$1 FOR UPDATE",
                [candidate.analytics_consent_id],
              )
            ).rows[0]
          : null;
        const a = (
          await db.query(
            "SELECT * FROM analytics_outbox WHERE id=$1 AND status='pending' AND next_attempt_at<=now() FOR UPDATE SKIP LOCKED",
            [candidate.id],
          )
        ).rows[0];
        if (!a) return;
        const measurement = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID?.trim();
        const secret = process.env.GA4_API_SECRET?.trim();
        const reason =
          !a.client_id ||
          !c ||
          c.revoked_at ||
          !c.fresh ||
          a.consent_version !== 1
            ? "no_consent"
            : !measurement || !secret
              ? "disabled"
              : null;
        if (reason) {
          await db.query(
            "UPDATE analytics_outbox SET status='skipped',last_error=$2 WHERE id=$1",
            [a.id, reason],
          );
          counts.skipped++;
          return;
        }
        let error: string | null = null;
        try {
          const response = await fetcher(
            `https://www.google-analytics.com/mp/collect?${new URLSearchParams({ measurement_id: measurement!, api_secret: secret! })}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: AbortSignal.timeout(5000),
              redirect: "error",
              body: JSON.stringify({
                client_id: a.client_id,
                consent: {
                  ad_user_data: "DENIED",
                  ad_personalization: "DENIED",
                },
                events: [
                  {
                    name: a.event_type,
                    params: {
                      ...a.payload,
                      ...(a.session_id
                        ? { session_id: Number(a.session_id) }
                        : {}),
                    },
                  },
                ],
              }),
            },
          );
          if (!response.ok) error = `http_${response.status}`;
        } catch {
          error = "transport_error";
        }
        const attempts = a.attempts + 1;
        if (error) {
          await db.query(
            `UPDATE analytics_outbox SET attempts=$2,last_error=$3,status=$4,
            next_attempt_at=now()+make_interval(secs=>$5) WHERE id=$1`,
            [
              a.id,
              attempts,
              error,
              attempts >= 5 ? "failed" : "pending",
              60 * 2 ** (attempts - 1),
            ],
          );
          counts.failed++;
        } else {
          await db.query(
            "UPDATE analytics_outbox SET status='sent',sent_at=now(),attempts=$2,last_error=NULL WHERE id=$1",
            [a.id, attempts],
          );
          counts.sent++;
        }
      });
    }
  } catch {
    // Never log the request URL, payload, customer data, or provider exception.
    console.error("Analytics worker database operation failed");
    counts.failed++;
  }
  return counts;
}
