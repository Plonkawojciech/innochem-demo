import { enqueueMailInTransaction } from "./mail";
import { z } from "zod";
import { query, transaction } from "./db";
import { audit } from "./admin";
import { cancelStripePayment, refreshStripePayment } from "./stripe-payments";
import {
  cancelPendingOrder,
  markOrderPaid,
  StoreError,
  tokenHash,
} from "./orders";

export const orderActionInput = z
  .object({
    action: z.enum([
      "confirm_bank",
      "cancel_pending",
      "process",
      "ship",
      "complete",
      "cancel_cod",
      "record_refund",
      "refresh_payment",
    ]),
    expectedStatus: z.string().min(1).max(40),
    idempotencyKey: z.uuid(),
    reference: z.string().trim().max(180).default(""),
    trackingNumber: z.string().trim().max(180).default(""),
    note: z.string().trim().max(2000).default(""),
    amountCents: z.number().int().min(0).optional(),
    restock: z.boolean().default(false),
  })
  .strict();
export async function actOnOrder(id: string, raw: unknown, actor: string) {
  z.uuid().parse(id);
  const p = orderActionInput.parse(raw);
  if (p.action === "confirm_bank") {
    if (!p.reference || p.amountCents === undefined)
      throw new StoreError(
        "PAYMENT_DETAILS_REQUIRED",
        "Podaj numer potwierdzenia i faktycznie zaksięgowaną kwotę.",
      );
    return markOrderPaid(
      id,
      `bank:${p.reference}`,
      p.amountCents,
      "PLN",
      actor,
      "bank_transfer",
    );
  }
  if (["cancel_pending", "refresh_payment"].includes(p.action)) {
    const order = (
      await query(
        "SELECT payment_method,status,legacy_id FROM orders WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!order || order.legacy_id)
      throw new StoreError(
        "NOT_FOUND",
        "Nie znaleziono bieżącego zamówienia.",
        404,
      );
    if (order.status !== p.expectedStatus)
      throw new StoreError(
        "VERSION_CONFLICT",
        "Status zamówienia zmienił się. Odśwież stronę.",
        409,
      );
    if (p.action === "refresh_payment") {
      if (order.payment_method !== "stripe")
        throw new StoreError(
          "PAYMENT_METHOD_MISMATCH",
          "To zamówienie nie korzysta ze Stripe.",
          409,
        );
      const result = await refreshStripePayment(
        id,
        undefined,
        p.reference || undefined,
      );
      await transaction((db) =>
        audit(db, actor, "order.payment_checked", id, {
          recovered: !!p.reference,
        }),
      );
      return { ...result, replayed: false };
    }
    return order.payment_method === "stripe"
      ? cancelStripePayment(id)
      : cancelPendingOrder(id, actor);
  }
  return transaction(async (db) => {
    const {
      rows: [order],
    } = await db.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [id]);
    if (!order)
      throw new StoreError("NOT_FOUND", "Nie znaleziono zamówienia.", 404);
    const eventKey = `admin-order:${p.idempotencyKey}`,
      fingerprint = tokenHash(JSON.stringify({ id, p, actor }));
    const {
      rows: [prior],
    } = await db.query(
      "SELECT order_id,data FROM order_events WHERE event_key=$1",
      [eventKey],
    );
    if (prior) {
      if (prior.order_id !== id || prior.data.fingerprint !== fingerprint)
        throw new StoreError(
          "IDEMPOTENCY_CONFLICT",
          "Identyfikator operacji został już użyty.",
          409,
        );
      return { status: prior.data.status, replayed: true };
    }
    if (order.legacy_id)
      throw new StoreError(
        "LEGACY_READ_ONLY",
        "Zamówienia archiwalne są tylko do odczytu.",
        409,
      );
    if (order.status !== p.expectedStatus)
      throw new StoreError(
        "VERSION_CONFLICT",
        "Status zamówienia zmienił się. Odśwież stronę.",
        409,
      );
    const allowed: Record<string, string[]> = {
      process: ["paid"],
      ship: ["paid", "processing"],
      complete: ["shipped"],
      cancel_cod: ["processing"],
      record_refund: [
        "paid",
        "processing",
        "shipped",
        "completed",
        "payment_review",
      ],
    };
    if (!allowed[p.action]?.includes(order.status))
      throw new StoreError(
        "INVALID_STATUS",
        "Ta operacja nie jest dostępna dla obecnego statusu.",
        409,
      );
    if (
      p.action === "cancel_cod" &&
      (order.payment_method !== "cod" || !order.stock_committed)
    )
      throw new StoreError(
        "INVALID_STATUS",
        "Anulowanie dotyczy wyłącznie niewysłanego zamówienia za pobraniem.",
        409,
      );
    if (
      p.action === "record_refund" &&
      (!p.reference || !p.note || p.amountCents !== order.total_cents)
    )
      throw new StoreError(
        "REFUND_PROOF_REQUIRED",
        "Zapisz pełną kwotę zwrotu, potwierdzenie oraz uzasadnienie. Ta operacja nie wykonuje przelewu.",
      );
    const restock =
      p.action === "cancel_cod" || (p.action === "record_refund" && p.restock);
    if (restock && !order.stock_committed)
      throw new StoreError(
        "NO_COMMITTED_STOCK",
        "Towar nie został odjęty z magazynu. Nie można go ponownie przyjąć.",
        409,
      );
    if (restock) {
      const { rows: items } = await db.query(
        "SELECT product_id,quantity FROM order_items WHERE order_id=$1 ORDER BY product_id",
        [id],
      );
      for (const item of items) {
        if (!item.product_id)
          throw new StoreError(
            "MISSING_PRODUCT",
            "Brak produktu w magazynie.",
            409,
          );
        await db.query(
          "UPDATE products SET stock=stock+$1,version=version+1,updated_at=now() WHERE id=$2",
          [item.quantity, item.product_id],
        );
        await db.query(
          "INSERT INTO stock_movements(product_id,order_id,quantity,reason,actor_id) VALUES($1,$2,$3,$4,$5)",
          [item.product_id, id, item.quantity, p.action, actor],
        );
      }
    }
    const status: string = (
      {
        process: "processing",
        ship: "shipped",
        complete: "completed",
        cancel_cod: "cancelled",
        record_refund: "refunded",
      } as Record<string, string>
    )[p.action];
    await db.query(
      "UPDATE orders SET status=$1,tracking_number=CASE WHEN $2='ship' THEN $3 ELSE tracking_number END,stock_committed=CASE WHEN $4 THEN false ELSE stock_committed END,updated_at=now() WHERE id=$5",
      [status, p.action, p.trackingNumber, restock, id],
    );
    await db.query(
      "INSERT INTO order_events(order_id,event_key,kind,data,actor_id) VALUES($1,$2,$3,$4,$5)",
      [
        id,
        eventKey,
        p.action,
        JSON.stringify({ ...p, status, fingerprint }),
        actor,
      ],
    );
    await audit(db, actor, `order.${p.action}`, id, {
      previousStatus: order.status,
      status,
      restock,
    });
    if (p.action === "ship") {
      const email = (
        await db.query(
          "SELECT value->>'contactEmail' AS email FROM settings WHERE key='store'",
        )
      ).rows[0].email;
      await enqueueMailInTransaction(
        db,
        order.email,
        `INNOCHEM — zamówienie ${order.number} wysłane`,
        `Zamówienie ${order.number} zostało wysłane.${p.trackingNumber ? `\nNumer przesyłki: ${p.trackingNumber}` : ""}\nKontakt: ${email}`,
        `order:${id}:shipped`,
      );
    }
    return { status, replayed: false };
  });
}
export async function adminOrder(id: string) {
  z.uuid().parse(id);
  const {
    rows: [order],
  } = await query("SELECT * FROM orders WHERE id=$1", [id]);
  if (!order) return null;
  const [{ rows: items }, { rows: events }] = await Promise.all([
    query("SELECT * FROM order_items WHERE order_id=$1 ORDER BY product_name", [
      id,
    ]),
    query(
      "SELECT kind,data,actor_id,created_at FROM order_events WHERE order_id=$1 ORDER BY created_at DESC",
      [id],
    ),
  ]);
  // Never serialize guest access hashes or idempotency keys to the admin UI.
  const { access_hash, idempotency_key, request_hash, ...safeOrder } = order;
  const payment =
    (
      await query(
        "SELECT provider_session_id,state,live_mode,last_checked_at FROM payment_sessions WHERE order_id=$1",
        [id],
      )
    ).rows[0] || null;
  return { order: safeOrder, items, events, payment };
}
