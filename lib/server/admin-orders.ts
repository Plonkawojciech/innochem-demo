import { enqueueAnalytics } from "./analytics";
import { enqueueMailInTransaction } from "./mail";
import { z } from "zod";
import { query, transaction } from "./db";
import { audit } from "./admin";
import {
  refundLineSchema,
  returnLineSchema,
  refundSummary,
  validateRefund,
  validateReturn,
  type RefundItem,
} from "./refunds";
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
      "record_return",
      "refresh_payment",
    ]),
    expectedStatus: z.string().min(1).max(40),
    idempotencyKey: z.uuid(),
    reference: z.string().trim().max(180).default(""),
    trackingNumber: z.string().trim().max(180).default(""),
    note: z.string().trim().max(2000).default(""),
    amountCents: z.number().int().min(0).optional(),
    restock: z.boolean().default(false),
    refundItems: z.array(refundLineSchema).max(50).optional(),
    shippingRefundCents: z.number().int().nonnegative().optional(),
    returnItems: z.array(returnLineSchema).max(50).optional(),
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
      record_return: [
        "paid",
        "processing",
        "shipped",
        "completed",
        "refunded",
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
    const items = (
      await db.query<RefundItem>(
        "SELECT * FROM order_items WHERE order_id=$1 ORDER BY product_id,id",
        [id],
      )
    ).rows;
    const events = (
      await db.query(
        "SELECT kind,data FROM order_events WHERE order_id=$1 AND kind IN ('record_refund','record_return')",
        [id],
      )
    ).rows;
    const summary = refundSummary(items, events);
    const accounting =
      p.action === "record_refund" || p.action === "record_return";
    if (accounting && (!p.reference || !p.note))
      throw new StoreError(
        "REFUND_PROOF_REQUIRED",
        "Zapisz potwierdzenie oraz uzasadnienie faktycznie wykonanej operacji. Ta operacja nie wysyła pieniędzy.",
      );
    const refund =
      p.action === "record_refund"
        ? validateRefund(summary, order.total_cents, order.shipping_cents, p)
        : null;
    if (refund && p.restock && !refund.full)
      throw new StoreError(
        "RETURN_ITEMS",
        "Częściowo zwrócony towar przyjmij osobną operacją z podaniem ilości.",
      );
    const allRemaining = summary.lines
      .filter((i) => i.quantity > i.returnedQuantity)
      .map((i) => ({
        itemId: i.id,
        quantity: i.quantity - i.returnedQuantity,
      }));
    const returnItems =
      p.action === "record_return"
        ? validateReturn(summary, p.returnItems || [])
        : p.action === "record_refund" && p.restock
          ? validateReturn(summary, allRemaining)
          : p.action === "cancel_cod"
            ? allRemaining
            : [];
    const restock = returnItems.length > 0;
    if (restock && !order.stock_committed)
      throw new StoreError(
        "NO_COMMITTED_STOCK",
        "Towar nie został odjęty z magazynu. Nie można go ponownie przyjąć.",
        409,
      );
    if (restock) {
      for (const r of returnItems) {
        const item = items.find((i) => i.id === r.itemId)!;
        if (!item.product_id)
          throw new StoreError(
            "MISSING_PRODUCT",
            "Brak produktu w magazynie.",
            409,
          );
        await db.query(
          "UPDATE products SET stock=stock+$1,version=version+1,updated_at=now() WHERE id=$2",
          [r.quantity, item.product_id],
        );
        await db.query(
          "INSERT INTO stock_movements(product_id,order_id,quantity,reason,actor_id) VALUES($1,$2,$3,$4,$5)",
          [item.product_id, id, r.quantity, p.action, actor],
        );
      }
    }
    const allReturned =
      restock &&
      summary.lines.every(
        (i) =>
          i.returnedQuantity +
            (returnItems.find((r) => r.itemId === i.id)?.quantity || 0) ===
          i.quantity,
      );
    const status: string = (
      {
        process: "processing",
        ship: "shipped",
        complete: "completed",
        cancel_cod: "cancelled",
        record_refund: refund?.full ? "refunded" : order.status,
        record_return: order.status,
      } as Record<string, string>
    )[p.action];
    await db.query(
      "UPDATE orders SET status=$1,tracking_number=CASE WHEN $2='ship' THEN $3 ELSE tracking_number END,stock_committed=CASE WHEN $4 THEN false ELSE stock_committed END,updated_at=now() WHERE id=$5",
      [status, p.action, p.trackingNumber, allReturned, id],
    );
    await db.query(
      "INSERT INTO order_events(order_id,event_key,kind,data,actor_id) VALUES($1,$2,$3,$4,$5)",
      [
        id,
        eventKey,
        p.action,
        JSON.stringify({
          ...p,
          ...(refund || {}),
          returnItems,
          status,
          fingerprint,
        }),
        actor,
      ],
    );
    if (refund)
      await enqueueAnalytics(db, id, "refund", {
        eventKey,
        lines: refund.refundItems,
        shippingCents: refund.shippingRefundCents,
      });
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
    query<RefundItem>(
      "SELECT * FROM order_items WHERE order_id=$1 ORDER BY product_name",
      [id],
    ),
    query<{
      kind: string;
      data: Record<string, any>;
      actor_id: string;
      created_at: string;
    }>(
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
  return {
    order: safeOrder,
    items,
    events,
    payment,
    refunds: refundSummary(items, events),
  };
}
