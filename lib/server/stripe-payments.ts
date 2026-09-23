import Stripe from "stripe";
import { z } from "zod";
import { query, transaction } from "./db";
import { StoreError } from "./errors";
import { stripeConfigured, stripeCheckoutReady } from "./stripe-config";
import {
  markOrderPaidInTransaction,
  cancelPendingOrderInTransaction,
  cancelPendingOrder,
} from "./orders";

type Session = Stripe.Checkout.Session;
export type StripeGateway = {
  create: (
    request: Stripe.Checkout.SessionCreateParams,
    key: string,
  ) => Promise<Session>;
  retrieve: (id: string) => Promise<Session>;
  expire: (id: string) => Promise<Session>;
};
function gateway(testGateway?: StripeGateway): StripeGateway {
  if (testGateway) {
    if (!process.env.PGDATABASE?.startsWith("innochem_test_"))
      throw new Error("Mock payments require an isolated test database");
    return testGateway;
  }
  if (!stripeConfigured())
    throw new StoreError(
      "PAYMENT_UNAVAILABLE",
      "Płatności online nie zostały skonfigurowane.",
      503,
    );
  if (
    process.env.STOREFRONT_PREVIEW !== "false" &&
    process.env.STRIPE_MODE !== "test"
  )
    throw new StoreError(
      "PAYMENT_PREVIEW",
      "Podgląd nie obsługuje rzeczywistych płatności.",
      503,
    );
  const client = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    maxNetworkRetries: 2,
    timeout: 15000,
  });
  return {
    create: (request, key) =>
      client.checkout.sessions.create(request, { idempotencyKey: key }),
    retrieve: (id) => client.checkout.sessions.retrieve(id),
    expire: (id) => client.checkout.sessions.expire(id),
  };
}
function paymentError() {
  return new StoreError(
    "PAYMENT_BINDING",
    "Niezgodne potwierdzenie płatności. Zamówienie wymaga sprawdzenia.",
    409,
  );
}
function checkedSession(
  session: Session,
  attempt: {
    order_id: string;
    provider_session_id: string | null;
    live_mode: boolean;
  },
  order: {
    total_cents: number;
    currency: string;
    payment_method: string;
    legacy_id: number | null;
  },
) {
  if (
    !session.id.startsWith("cs_") ||
    (attempt.provider_session_id &&
      attempt.provider_session_id !== session.id) ||
    session.mode !== "payment" ||
    session.livemode !== attempt.live_mode ||
    session.client_reference_id !== attempt.order_id ||
    session.metadata?.orderId !== attempt.order_id ||
    session.metadata?.integration !== "innochem-v1" ||
    session.amount_total !== order.total_cents ||
    session.currency?.toUpperCase() !== order.currency ||
    order.payment_method !== "stripe" ||
    order.legacy_id
  )
    throw paymentError();
}
function checkoutUrl(session: Session) {
  if (!session.url) return null;
  const url = new URL(session.url);
  if (
    url.origin !== "https://checkout.stripe.com" ||
    !url.pathname.startsWith("/c/pay/") ||
    url.username ||
    url.password
  )
    throw paymentError();
  return url.href;
}
export async function startStripePayment(
  orderId: string,
  testGateway?: StripeGateway,
) {
  z.uuid().parse(orderId);
  const api = gateway(testGateway);
  if (!testGateway && !stripeCheckoutReady())
    throw new StoreError(
      "PAYMENT_UNAVAILABLE",
      "Płatności online są chwilowo niedostępne.",
      503,
    );
  const attempt = await transaction(async (db) => {
    const order = (
      await db.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [orderId])
    ).rows[0];
    if (
      !order ||
      order.legacy_id ||
      order.payment_method !== "stripe" ||
      order.currency !== "PLN"
    )
      throw paymentError();
    if (order.status !== "pending_payment")
      throw new StoreError(
        "PAYMENT_STATUS",
        "Sprawdź bieżący status zamówienia.",
        409,
      );
    const existing = (
      await db.query("SELECT * FROM payment_sessions WHERE order_id=$1", [
        orderId,
      ])
    ).rows[0];
    if (existing) {
      if (["paid", "failed", "expired", "review"].includes(existing.state))
        throw new StoreError(
          "PAYMENT_CLOSED",
          "Ta płatność została już zakończona. Sprawdź zamówienie.",
          409,
        );
      if (
        existing.live_mode !==
        (!testGateway && process.env.STRIPE_MODE === "live")
      )
        throw paymentError();
      if (
        !existing.provider_session_id &&
        new Date(existing.expires_at).getTime() <= Date.now()
      )
        throw new StoreError(
          "PAYMENT_EXPIRED",
          "Czas na płatność minął. Złóż nowe zamówienie.",
          409,
        );
      return existing;
    }
    if (
      !order.reservation_expires_at ||
      new Date(order.reservation_expires_at).getTime() <= Date.now()
    )
      throw new StoreError(
        "PAYMENT_EXPIRED",
        "Czas rezerwacji minął. Złóż nowe zamówienie.",
        409,
      );
    const items = (
      await db.query(
        "SELECT product_name,quantity,unit_price_cents FROM order_items WHERE order_id=$1 ORDER BY id",
        [orderId],
      )
    ).rows;
    const total =
      items.reduce((n, i) => n + i.quantity * i.unit_price_cents, 0) +
      order.shipping_cents;
    if (total !== order.total_cents || total <= 0) throw paymentError();
    const expiresAt = Math.floor(Date.now() / 1000) + 31 * 60;
    const origin = new URL(process.env.APP_URL!).origin;
    const request: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      locale: "pl",
      client_reference_id: orderId,
      metadata: { orderId, integration: "innochem-v1" },
      payment_intent_data: {
        metadata: { orderId, integration: "innochem-v1" },
      },
      customer_email: order.email,
      payment_method_types: ["card", "blik", "p24"],
      adaptive_pricing: { enabled: false },
      allow_promotion_codes: false,
      line_items: [
        ...items.map((i) => ({
          quantity: i.quantity,
          price_data: {
            currency: "pln",
            unit_amount: i.unit_price_cents,
            product_data: { name: i.product_name },
          },
        })),
        ...(order.shipping_cents
          ? [
              {
                quantity: 1,
                price_data: {
                  currency: "pln",
                  unit_amount: order.shipping_cents,
                  product_data: { name: `Dostawa: ${order.shipping_label}` },
                },
              },
            ]
          : []),
      ],
      success_url: `${origin}/zamowienie/${orderId}?platnosc=powrot`,
      cancel_url: `${origin}/zamowienie/${orderId}?platnosc=przerwana`,
      expires_at: expiresAt,
    };
    const result = (
      await db.query(
        "INSERT INTO payment_sessions(order_id,provider,idempotency_key,request,live_mode,expires_at) VALUES($1,'stripe',$2,$3,$4,to_timestamp($5)) RETURNING *",
        [
          orderId,
          `innochem-checkout-${orderId}`,
          JSON.stringify(request),
          !testGateway && process.env.STRIPE_MODE === "live",
          expiresAt,
        ],
      )
    ).rows[0];
    await db.query(
      "UPDATE orders SET payment_provider='stripe',reservation_expires_at=to_timestamp($2),updated_at=now() WHERE id=$1",
      [orderId, expiresAt],
    );
    return result;
  });
  let session: Session;
  try {
    session = attempt.provider_session_id
      ? await api.retrieve(attempt.provider_session_id)
      : await api.create(attempt.request, attempt.idempotency_key);
  } catch {
    throw new StoreError(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Nie udało się połączyć z operatorem. Możesz spróbować ponownie przy tym samym zamówieniu.",
      503,
    );
  }
  // Persist the verified session before giving the browser a checkout link.
  await applyStripeSession(session, undefined, orderId);
  return {
    url: session.status === "open" ? checkoutUrl(session) : null,
    status:
      session.payment_status === "paid"
        ? "paid"
        : session.status === "complete"
          ? "processing"
          : session.status,
  };
}
export async function applyStripeSession(
  session: Session,
  event?: { id: string; type: string },
  expectedOrderId?: string,
) {
  const orderId = z.uuid().parse(session.metadata?.orderId);
  if (expectedOrderId && expectedOrderId !== orderId) throw paymentError();
  return transaction(async (db) => {
    const order = (
      await db.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [orderId])
    ).rows[0];
    const attempt = (
      await db.query(
        "SELECT * FROM payment_sessions WHERE order_id=$1 FOR UPDATE",
        [orderId],
      )
    ).rows[0];
    if (!order || !attempt) throw paymentError();
    checkedSession(session, attempt, order);
    if (event) {
      const saved = await db.query(
        "INSERT INTO payment_webhook_events(provider,event_id,event_type,order_id) VALUES('stripe',$1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id",
        [event.id, event.type, orderId],
      );
      if (!saved.rowCount) return { replayed: true, status: order.status };
    }
    let state = attempt.state,
      status = order.status;
    if (session.payment_status === "paid") {
      if (session.status !== "complete") throw paymentError();
      const intent =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;
      if (!intent?.startsWith("pi_")) throw paymentError();
      const result = await markOrderPaidInTransaction(
        db,
        orderId,
        `stripe:${intent}`,
        order.total_cents,
        order.currency,
        "stripe-webhook",
        "stripe",
      );
      state = result.status === "payment_review" ? "review" : "paid";
      status = result.status;
    } else if (
      !["paid", "review"].includes(attempt.state) &&
      !order.stock_committed
    ) {
      if (
        session.status === "expired" ||
        event?.type === "checkout.session.async_payment_failed"
      ) {
        if (order.status === "pending_payment")
          await cancelPendingOrderInTransaction(
            db,
            orderId,
            "stripe",
            false,
            true,
          );
        state = session.status === "expired" ? "expired" : "failed";
        status =
          order.status === "pending_payment" ? "cancelled" : order.status;
      } else if (session.status === "complete") {
        state = "processing";
        // A delayed bank payment must not lose its stock reservation while pending.
        if (order.status === "pending_payment")
          await db.query(
            "UPDATE orders SET reservation_expires_at=NULL,updated_at=now() WHERE id=$1",
            [orderId],
          );
      } else if (session.status === "open" && attempt.state !== "processing")
        state = "open";
    }
    await db.query(
      "UPDATE payment_sessions SET provider_session_id=$2,state=$3,last_checked_at=now(),updated_at=now() WHERE order_id=$1",
      [orderId, session.id, state],
    );
    return { replayed: false, status };
  });
}
const handledEvents = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);
export function verifyStripeEvent(payload: string, signature: string) {
  if (!process.env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_"))
    throw new StoreError(
      "PAYMENT_UNAVAILABLE",
      "Płatności nie są skonfigurowane.",
      503,
    );
  try {
    return Stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    throw new StoreError(
      "SIGNATURE_INVALID",
      "Nieprawidłowe potwierdzenie płatności.",
      400,
    );
  }
}
export async function handleStripeEvent(
  event: Stripe.Event,
  testGateway?: StripeGateway,
) {
  if (!handledEvents.has(event.type)) return { ignored: true };
  if ((event.data.object as Session).metadata?.integration !== "innochem-v1")
    return { ignored: true };
  const api = gateway(testGateway);
  if (
    event.account ||
    event.livemode !== (!testGateway && process.env.STRIPE_MODE === "live")
  )
    throw paymentError();
  const object = event.data.object as Session;
  if (!object.id?.startsWith("cs_")) throw paymentError();
  // Fetch current provider state, avoiding out-of-order or stale notifications.
  const session = await api.retrieve(object.id);
  if (session.id !== object.id) throw paymentError();
  return applyStripeSession(session, { id: event.id, type: event.type });
}
export async function cancelStripePayment(
  orderId: string,
  testGateway?: StripeGateway,
) {
  const row = (
    await query(
      "SELECT provider_session_id FROM payment_sessions WHERE order_id=$1",
      [orderId],
    )
  ).rows[0];
  if (!row) return cancelPendingOrder(orderId, "admin:stripe-cancel");
  if (!row?.provider_session_id)
    throw new StoreError(
      "PAYMENT_CHECK_REQUIRED",
      "Nie potwierdzono stanu płatności u operatora. Sprawdź ją w Stripe i uzgodnij sesję w panelu przed anulowaniem.",
      409,
    );
  const api = gateway(testGateway);
  let session = await api.retrieve(row.provider_session_id);
  if (session.status === "open") session = await api.expire(session.id);
  await applyStripeSession(session, undefined, orderId);
  if (session.status !== "expired")
    throw new StoreError(
      "PAYMENT_IN_PROGRESS",
      "Operator przetwarza lub potwierdził płatność. Sprawdź aktualny status przed anulowaniem.",
      409,
    );
  return { cancelled: true, replayed: false };
}
export async function refreshStripePayment(
  orderId: string,
  testGateway?: StripeGateway,
  recoverySessionId?: string,
) {
  z.uuid().parse(orderId);
  const row = (
    await query(
      "SELECT provider_session_id FROM payment_sessions WHERE order_id=$1",
      [orderId],
    )
  ).rows[0];
  const sessionId = row?.provider_session_id || recoverySessionId;
  if (!sessionId) return { refreshed: false };
  if (!row || !/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) throw paymentError();
  const api = gateway(testGateway);
  let session: Session;
  try {
    session = await api.retrieve(sessionId);
  } catch {
    throw new StoreError(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "Nie udało się odczytać statusu u operatora. Spróbuj ponownie później.",
      503,
    );
  }
  if (session.id !== sessionId) throw paymentError();
  await applyStripeSession(session, undefined, orderId);
  return { refreshed: true };
}
export async function reconcileStripePayments(testGateway?: StripeGateway) {
  if (!testGateway && !stripeConfigured()) return { checked: 0, failed: 0 };
  const api = gateway(testGateway);
  const pending = await query(
    "SELECT ps.order_id,ps.provider_session_id FROM payment_sessions ps JOIN orders o ON o.id=ps.order_id WHERE ps.provider_session_id IS NOT NULL AND ps.state IN ('open','processing') AND o.status='pending_payment' ORDER BY ps.last_checked_at NULLS FIRST LIMIT 10",
  );
  let checked = 0,
    failed = 0;
  for (const row of pending.rows) {
    try {
      await applyStripeSession(
        await api.retrieve(row.provider_session_id),
        undefined,
        row.order_id,
      );
      checked++;
    } catch {
      failed++;
      await query(
        "UPDATE payment_sessions SET last_checked_at=now() WHERE order_id=$1",
        [row.order_id],
      );
    }
  }
  return { checked, failed };
}
