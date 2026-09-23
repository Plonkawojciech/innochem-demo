import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { enqueueMailInTransaction } from "./mail";
import { z } from "zod";
import type { PoolClient } from "pg";
import { query, transaction } from "./db";
import { checkoutReady, settingsSchema } from "./settings";
import { StoreError } from "./errors";
import { stripeCheckoutReady } from "./stripe-config";
export { StoreError } from "./errors";
import { legalText, type LegalDocument } from "./legal";
const text = (max: number) => z.string().trim().min(1).max(max);
const linesSchema = z
  .array(
    z
      .object({
        productId: z.uuid(),
        quantity: z.number().int().min(1).max(999),
      })
      .strict(),
  )
  .min(1)
  .max(50)
  .refine(
    (lines) => new Set(lines.map((l) => l.productId)).size === lines.length,
    "Produkt występuje w koszyku więcej niż raz.",
  );
export const checkoutSchema = z
  .object({
    idempotencyKey: z.uuid(),
    lines: linesSchema,
    buyer: z
      .object({
        firstName: text(80),
        lastName: text(100),
        email: z
          .email()
          .max(254)
          .transform((x) => x.toLowerCase()),
        phone: z
          .string()
          .trim()
          .regex(/^[+\d\s()-]{7,25}$/),
        company: z.string().trim().max(180).default(""),
        nip: z.string().trim().max(20).default(""),
      })
      .strict(),
    address: z
      .object({
        street: text(180),
        postalCode: z.string().regex(/^\d{2}-\d{3}$/),
        city: text(100),
        country: z.literal("PL"),
      })
      .strict(),
    shippingMethod: text(60),
    paymentMethod: z.enum(["bank_transfer", "cod", "stripe"]),
    expectedTotalCents: z.number().int().min(0).max(100000000),
    termsAccepted: z.literal(true),
    termsVersion: text(80),
  })
  .strict();
export type CheckoutInput = z.infer<typeof checkoutSchema>;
function tokenFor(orderId: string, key: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Order access secret not configured");
  return createHmac("sha256", secret)
    .update(`order:${orderId}:${key}`)
    .digest("base64url");
}
export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function validOrderToken(token: string, hash: string | null) {
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return false;
  return timingSafeEqual(
    Buffer.from(tokenHash(token), "hex"),
    Buffer.from(hash, "hex"),
  );
}
async function event(
  db: PoolClient,
  orderId: string,
  kind: string,
  data: unknown = {},
  actorId?: string,
  key?: string,
) {
  await db.query(
    "INSERT INTO order_events(order_id,kind,data,actor_id,event_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_key) DO NOTHING",
    [orderId, kind, JSON.stringify(data), actorId || null, key || null],
  );
}

export async function createOrder(
  raw: unknown,
  customerId: string | null = null,
) {
  const input = checkoutSchema.parse(raw);
  input.lines.sort((a, b) => a.productId.localeCompare(b.productId));
  const fingerprint = tokenHash(JSON.stringify({ input, customerId }));
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      input.idempotencyKey,
    ]);
    const existing = await db.query(
      "SELECT id,number,request_hash FROM orders WHERE idempotency_key=$1",
      [input.idempotencyKey],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== fingerprint)
        throw new StoreError(
          "IDEMPOTENCY_CONFLICT",
          "To żądanie zamówienia było już użyte z innymi danymi.",
          409,
        );
      return {
        id: existing.rows[0].id as string,
        number: String(existing.rows[0].number),
        accessToken: tokenFor(existing.rows[0].id, input.idempotencyKey),
        replayed: true,
      };
    }
    const configuration = await db.query(
      "SELECT value FROM settings WHERE key='store' FOR SHARE",
    );
    const settings = settingsSchema.parse(configuration.rows[0]?.value);
    if (!checkoutReady(settings))
      throw new StoreError(
        "CHECKOUT_UNAVAILABLE",
        "Zamówienia online nie są jeszcze dostępne. Skontaktuj się z nami telefonicznie.",
        503,
      );
    if (input.termsVersion !== settings.termsVersion)
      throw new StoreError(
        "TERMS_CHANGED",
        "Warunki zakupu zmieniły się. Odśwież stronę i zapoznaj się z aktualnym regulaminem.",
        409,
      );
    const shipping = settings.shippingMethods.find(
      (s) => s.id === input.shippingMethod && s.enabled,
    );
    const {
      rows: [legal],
    } = await db.query<{ documents: LegalDocument[] }>(
      "SELECT documents FROM legal_versions WHERE version=$1",
      [settings.termsVersion],
    );
    if (!legal)
      throw new StoreError(
        "LEGAL_UNAPPROVED",
        "Warunki sprzedaży nie zostały jeszcze zatwierdzone.",
        503,
      );
    if (
      !shipping ||
      !settings.paymentMethods.includes(input.paymentMethod) ||
      (input.paymentMethod === "cod" && !shipping.cod)
    )
      throw new StoreError(
        "METHOD_UNAVAILABLE",
        "Wybrana metoda dostawy lub płatności jest niedostępna.",
      );
    if (input.paymentMethod === "bank_transfer" && !settings.bankAccount.trim())
      throw new StoreError(
        "PAYMENT_UNAVAILABLE",
        "Przelew tradycyjny jest chwilowo niedostępny.",
        503,
      );
    if (input.paymentMethod === "stripe" && !stripeCheckoutReady())
      throw new StoreError(
        "PAYMENT_UNAVAILABLE",
        "Płatności online są chwilowo niedostępne.",
        503,
      );
    const { rows: products } = await db.query(
      "SELECT * FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [input.lines.map((l) => l.productId)],
    );
    if (products.length !== input.lines.length)
      throw new StoreError(
        "PRODUCT_UNAVAILABLE",
        "Jeden z produktów nie jest już dostępny.",
      );
    let subtotal = 0,
      weight = 0;
    const items = input.lines.map((line) => {
      const p = products.find((p) => p.id === line.productId)!;
      if (
        p.status !== "active" ||
        p.sale_mode !== "retail" ||
        p.price_cents <= 0
      )
        throw new StoreError(
          "PRODUCT_UNAVAILABLE",
          `${p.name}: produkt nie jest dostępny w sprzedaży online.`,
        );
      if (p.stock - p.reserved < line.quantity)
        throw new StoreError(
          "OUT_OF_STOCK",
          `${p.name}: dostępna ilość to ${p.stock - p.reserved} szt.`,
          409,
        );
      subtotal += p.price_cents * line.quantity;
      weight += p.weight_grams * line.quantity;
      return {
        ...line,
        name: p.name,
        sku: p.sku,
        price: p.price_cents,
        tax: p.tax_rate,
      };
    });
    if (shipping.maxWeightGrams && products.some((p) => p.weight_grams <= 0))
      throw new StoreError(
        "SHIPPING_WEIGHT_UNKNOWN",
        "Nie można potwierdzić masy tej przesyłki. Skontaktuj się ze sklepem, aby ustalić dostawę.",
        409,
      );
    if (shipping.maxWeightGrams && weight > shipping.maxWeightGrams)
      throw new StoreError(
        "SHIPPING_LIMIT",
        "Przesyłka przekracza limit wybranej metody dostawy.",
      );
    const total = subtotal + shipping.priceCents;
    if (!Number.isSafeInteger(total) || total > 100000000)
      throw new StoreError(
        "TOTAL_LIMIT",
        "Wartość zamówienia wymaga indywidualnego ustalenia.",
      );
    if (input.expectedTotalCents !== total)
      throw new StoreError(
        "PRICE_CHANGED",
        "Cena lub koszt dostawy zmieniły się. Sprawdź aktualne podsumowanie.",
        409,
      );
    const cod = input.paymentMethod === "cod";
    const {
      rows: [order],
    } = await db.query(
      `INSERT INTO orders(customer_id,idempotency_key,request_hash,email,buyer,shipping_address,status,payment_method,subtotal_cents,shipping_cents,total_cents,shipping_method,shipping_label,reservation_expires_at,stock_committed,terms_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CASE WHEN $14::int=0 THEN NULL ELSE now()+make_interval(mins=>$14) END,$15,$16) RETURNING id,number`,
      [
        customerId,
        input.idempotencyKey,
        fingerprint,
        input.buyer.email,
        JSON.stringify(input.buyer),
        JSON.stringify(input.address),
        cod ? "processing" : "pending_payment",
        input.paymentMethod,
        subtotal,
        shipping.priceCents,
        total,
        shipping.id,
        shipping.label,
        cod ? 0 : input.paymentMethod === "bank_transfer" ? 4320 : 30,
        cod,
        settings.termsVersion,
      ],
    );
    const accessToken = tokenFor(order.id, input.idempotencyKey);
    await db.query(
      "UPDATE orders SET access_hash=$1,legal_version=terms_version WHERE id=$2",
      [tokenHash(accessToken), order.id],
    );
    for (const item of items) {
      await db.query(
        "INSERT INTO order_items(order_id,product_id,product_name,sku,quantity,unit_price_cents,tax_rate,total_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          order.id,
          item.productId,
          item.name,
          item.sku,
          item.quantity,
          item.price,
          item.tax,
          item.price * item.quantity,
        ],
      );
      if (cod) {
        await db.query(
          "UPDATE products SET stock=stock-$1,version=version+1,updated_at=now() WHERE id=$2",
          [item.quantity, item.productId],
        );
        await db.query(
          "INSERT INTO stock_movements(product_id,order_id,quantity,reason) VALUES($1,$2,$3,'order_cod')",
          [item.productId, order.id, -item.quantity],
        );
      } else
        await db.query(
          "UPDATE products SET reserved=reserved+$1,version=version+1,updated_at=now() WHERE id=$2",
          [item.quantity, item.productId],
        );
    }
    await event(db, order.id, "created", {
      paymentMethod: input.paymentMethod,
      termsVersion: settings.termsVersion,
    });
    const lines = items
      .map(
        (i) =>
          `${i.name} — ${i.quantity} szt. — ${((i.price * i.quantity) / 100).toFixed(2)} zł`,
      )
      .join("\n");
    const payment =
      input.paymentMethod === "bank_transfer"
        ? `\nRachunek do przelewu: ${settings.bankAccount}\nTytuł: INNOCHEM ${order.number}`
        : cod
          ? "\nPłatność przy odbiorze."
          : "\nZamówienie oczekuje na potwierdzenie płatności.";
    const body = `Zamówienie INNOCHEM ${order.number}\n\n${lines}\nDostawa: ${shipping.label} — ${(shipping.priceCents / 100).toFixed(2)} zł\nRazem: ${(total / 100).toFixed(2)} zł${payment}\n\nKontakt: ${settings.contactEmail}`;
    for (const [suffix, recipient] of [
      ["customer", input.buyer.email],
      ["store", settings.orderEmail],
    ])
      await enqueueMailInTransaction(
        db,
        recipient,
        `INNOCHEM — zamówienie ${order.number}`,
        `${body}\n\nWarunki zakupu — wersja ${settings.termsVersion}\n\n${legalText(legal.documents)}`,
        `order:${order.id}:created:${suffix}`,
      );
    return {
      id: order.id as string,
      number: String(order.number),
      accessToken,
      replayed: false,
    };
  });
}

export async function markOrderPaid(
  orderId: string,
  reference: string,
  amount: number,
  currency: string,
  actorId?: string,
  requiredMethod?: "bank_transfer" | "p24" | "stripe",
) {
  return transaction((db) =>
    markOrderPaidInTransaction(
      db,
      orderId,
      reference,
      amount,
      currency,
      actorId,
      requiredMethod,
    ),
  );
}
export async function markOrderPaidInTransaction(
  db: PoolClient,
  orderId: string,
  reference: string,
  amount: number,
  currency: string,
  actorId?: string,
  requiredMethod?: "bank_transfer" | "p24" | "stripe",
) {
  const {
    rows: [order],
  } = await db.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [orderId]);
  if (!order)
    throw new StoreError("NOT_FOUND", "Nie znaleziono zamówienia.", 404);
  if (requiredMethod && order.payment_method !== requiredMethod)
    throw new StoreError(
      "PAYMENT_METHOD_MISMATCH",
      "Metoda płatności zamówienia jest inna.",
      409,
    );
  if (order.total_cents !== amount || order.currency !== currency)
    throw new StoreError(
      "PAYMENT_MISMATCH",
      "Niezgodna kwota lub waluta płatności.",
      409,
    );
  if (order.legacy_id || order.payment_method === "cod")
    throw new StoreError(
      "INVALID_PAYMENT",
      "Nieprawidłowy typ zamówienia.",
      409,
    );
  if (
    order.payment_reference === reference &&
    [
      "paid",
      "processing",
      "shipped",
      "completed",
      "refunded",
      "payment_review",
    ].includes(order.status)
  )
    return { status: order.status, replayed: true };
  if (order.payment_reference && order.payment_reference !== reference)
    throw new StoreError(
      "DUPLICATE_PAYMENT",
      "Zamówienie ma już przypisaną inną płatność.",
      409,
    );
  if (order.status !== "pending_payment") {
    await db.query(
      "UPDATE orders SET status='payment_review',payment_reference=$1,updated_at=now() WHERE id=$2",
      [reference, orderId],
    );
    await event(
      db,
      orderId,
      "late_payment",
      { reference, previousStatus: order.status },
      actorId,
      `payment:${reference}`,
    );
    return { status: "payment_review", replayed: false };
  }
  const { rows: items } = await db.query(
    "SELECT product_id,quantity FROM order_items WHERE order_id=$1 ORDER BY product_id",
    [orderId],
  );
  for (const item of items) {
    const change = await db.query(
      "UPDATE products SET stock=stock-$1,reserved=reserved-$1,version=version+1,updated_at=now() WHERE id=$2 AND stock >= $1 AND reserved >= $1",
      [item.quantity, item.product_id],
    );
    if (change.rowCount !== 1)
      throw new StoreError(
        "STOCK_INCONSISTENT",
        "Niezgodność rezerwacji magazynowej.",
        409,
      );
    await db.query(
      "INSERT INTO stock_movements(product_id,order_id,quantity,reason,actor_id) VALUES($1,$2,$3,'order_paid',$4)",
      [item.product_id, orderId, -item.quantity, actorId || null],
    );
  }
  await db.query(
    "UPDATE orders SET status='paid',stock_committed=true,reservation_expires_at=NULL,payment_reference=$1,updated_at=now() WHERE id=$2",
    [reference, orderId],
  );
  await event(
    db,
    orderId,
    "paid",
    { reference, amount, currency },
    actorId,
    `payment:${reference}`,
  );
  await enqueueMailInTransaction(
    db,
    order.email,
    `INNOCHEM — płatność za zamówienie ${order.number}`,
    `Potwierdzamy płatność ${(amount / 100).toFixed(2)} zł za zamówienie ${order.number}.`,
    `order:${orderId}:paid`,
  );
  return { status: "paid", replayed: false };
}

export async function cancelPendingOrder(
  orderId: string,
  actorId?: string,
  expiredOnly = false,
) {
  return transaction((db) =>
    cancelPendingOrderInTransaction(db, orderId, actorId, expiredOnly),
  );
}
export async function cancelPendingOrderInTransaction(
  db: PoolClient,
  orderId: string,
  actorId?: string,
  expiredOnly = false,
  providerConfirmed = false,
) {
  const {
    rows: [order],
  } = await db.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [orderId]);
  if (!order)
    throw new StoreError("NOT_FOUND", "Nie znaleziono zamówienia.", 404);
  if (order.status === "cancelled") return { cancelled: true, replayed: true };
  if (order.payment_method === "stripe" && !providerConfirmed) {
    const attempt = (
      await db.query("SELECT state FROM payment_sessions WHERE order_id=$1", [
        orderId,
      ])
    ).rows[0];
    if (attempt && !["expired", "failed"].includes(attempt.state)) {
      if (expiredOnly) return { cancelled: false, replayed: false };
      throw new StoreError(
        "PAYMENT_CHECK_REQUIRED",
        "Najpierw potwierdź stan płatności u operatora.",
        409,
      );
    }
  }
  if (
    order.status !== "pending_payment" ||
    order.stock_committed ||
    order.legacy_id
  )
    throw new StoreError(
      "INVALID_STATUS",
      "Anulowanie wymaga rozliczenia płatności i towaru.",
      409,
    );
  if (
    expiredOnly &&
    (!order.reservation_expires_at ||
      new Date(order.reservation_expires_at).getTime() > Date.now())
  )
    return { cancelled: false, replayed: false };
  const { rows: items } = await db.query(
    "SELECT product_id,quantity FROM order_items WHERE order_id=$1 ORDER BY product_id",
    [orderId],
  );
  for (const item of items) {
    const change = await db.query(
      "UPDATE products SET reserved=reserved-$1,version=version+1,updated_at=now() WHERE id=$2 AND reserved >= $1",
      [item.quantity, item.product_id],
    );
    if (change.rowCount !== 1)
      throw new StoreError(
        "STOCK_INCONSISTENT",
        "Niezgodność rezerwacji magazynowej.",
        409,
      );
  }
  await db.query(
    "UPDATE orders SET status='cancelled',reservation_expires_at=NULL,updated_at=now() WHERE id=$1",
    [orderId],
  );
  await event(
    db,
    orderId,
    expiredOnly ? "reservation_expired" : "cancelled",
    {},
    actorId,
  );
  return { cancelled: true, replayed: false };
}
export async function expireReservations() {
  const { rows } = await query(
    "SELECT id FROM orders WHERE status='pending_payment' AND reservation_expires_at<now() AND NOT EXISTS(SELECT 1 FROM payment_sessions ps WHERE ps.order_id=orders.id AND ps.state IN ('creating','open','processing')) ORDER BY reservation_expires_at LIMIT 100",
  );
  let expired = 0;
  for (const row of rows) {
    try {
      if ((await cancelPendingOrder(row.id, undefined, true)).cancelled)
        expired++;
    } catch (error) {
      if (!(error instanceof StoreError && error.code === "INVALID_STATUS"))
        throw error;
    }
  }
  return expired;
}
export async function accessibleOrder(
  id: string,
  customerId: string | null,
  token?: string,
) {
  if (!z.uuid().safeParse(id).success) return null;
  const {
    rows: [order],
  } = await query("SELECT * FROM orders WHERE id=$1", [id]);
  if (
    !order ||
    (!(customerId && order.customer_id === customerId) &&
      !(token && validOrderToken(token, order.access_hash)))
  )
    return null;
  const { rows: items } = await query(
    "SELECT product_name,sku,quantity,unit_price_cents,total_cents FROM order_items WHERE order_id=$1 ORDER BY product_name",
    [id],
  );
  return { order, items };
}
