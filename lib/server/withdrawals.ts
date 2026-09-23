import { createHmac } from "node:crypto";
import { z } from "zod";
import { transaction, query } from "./db";
import { tokenHash, validOrderToken } from "./orders";
import { StoreError } from "./errors";
import { storeSettings } from "./settings";
export const withdrawalInput = z
  .object({
    idempotencyKey: z.uuid(),
    name: z.string().trim().min(2).max(120),
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    purchaseReference: z.string().trim().min(1).max(180),
    scope: z.string().trim().min(1).max(3000),
    confirmed: z.literal(true),
  })
  .strict();
export async function createWithdrawal(
  raw: unknown,
  customerId: string | null = null,
) {
  const data = withdrawalInput.parse(raw),
    secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Authentication secret is not configured");
  const accessToken = createHmac("sha256", secret)
    .update(`withdrawal:${data.idempotencyKey}`)
    .digest("base64url");
  const fingerprint = tokenHash(JSON.stringify({ data, customerId }));
  const preview = process.env.STOREFRONT_PREVIEW !== "false",
    settings = await storeSettings();
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `withdrawal:${data.idempotencyKey}`,
    ]);
    const previous = (
      await db.query(
        "SELECT id,reference,request_hash,receipt_text,preview FROM withdrawals WHERE idempotency_key=$1",
        [data.idempotencyKey],
      )
    ).rows[0];
    if (previous) {
      if (previous.request_hash !== fingerprint)
        throw new StoreError(
          "IDEMPOTENCY_CONFLICT",
          "Ten formularz został już zapisany z innymi danymi. Sprawdź poprzednie potwierdzenie.",
          409,
        );
      return {
        id: previous.id,
        reference: String(previous.reference),
        receipt: previous.receipt_text,
        preview: previous.preview,
        accessToken,
        replayed: true,
      };
    }
    const declaration = `Oświadczam, że odstępuję od umowy sprzedaży.\nZamówienie lub opis zakupu: ${data.purchaseReference}\nZakres odstąpienia: ${data.scope}\nImię i nazwisko: ${data.name}\nE-mail do potwierdzenia: ${data.email}`;
    const row = (
      await db.query(
        "INSERT INTO withdrawals(customer_id,idempotency_key,request_hash,access_hash,name,email,purchase_reference,scope,declaration,receipt_text,preview) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'',$10) RETURNING id,reference,created_at",
        [
          customerId,
          data.idempotencyKey,
          fingerprint,
          tokenHash(accessToken),
          data.name,
          data.email,
          data.purchaseReference,
          data.scope,
          declaration,
          preview,
        ],
      )
    ).rows[0];
    const receipt = `INNOCHEM — potwierdzenie otrzymania oświadczenia o odstąpieniu\nNumer: OD-${row.reference}\nOtrzymano: ${new Date(row.created_at).toISOString()} (UTC)\n${preview ? "\nPODGLĄD TESTOWY. Nie przekazano oświadczenia do działającego sklepu ani nie wysłano wiadomości.\n" : ""}\n${declaration}\n\nTo potwierdzenie dokumentuje otrzymanie oświadczenia. Obsługa zwrotu towaru i rozliczenie płatności odbywają się zgodnie z warunkami sprzedaży.\n`;
    await db.query("UPDATE withdrawals SET receipt_text=$2 WHERE id=$1", [
      row.id,
      receipt,
    ]);
    for (const [suffix, email] of [
      ["customer", data.email],
      ["store", settings.contactEmail],
    ])
      await db.query(
        "INSERT INTO mail_outbox(event_key,recipient,subject,body_text,preview) VALUES($1,$2,$3,$4,$5)",
        [
          `withdrawal:${row.id}:${suffix}`,
          email,
          `INNOCHEM — oświadczenie OD-${row.reference}`,
          receipt,
          preview,
        ],
      );
    return {
      id: row.id,
      reference: String(row.reference),
      receipt,
      preview,
      accessToken,
      replayed: false,
    };
  });
}
export async function accessibleWithdrawal(
  id: string,
  customerId: string | null,
  token?: string,
) {
  if (!z.uuid().safeParse(id).success) return null;
  const row = (await query("SELECT * FROM withdrawals WHERE id=$1", [id]))
    .rows[0];
  if (
    !row ||
    (!(customerId && row.customer_id === customerId) &&
      !(token && validOrderToken(token, row.access_hash)))
  )
    return null;
  return {
    id: row.id,
    reference: String(row.reference),
    receipt: row.receipt_text,
  };
}
export async function updateWithdrawal(
  id: string,
  raw: unknown,
  actor: string,
) {
  z.uuid().parse(id);
  const data = z
    .object({
      version: z.number().int().positive(),
      status: z.enum(["received", "in_review", "closed"]),
      note: z.string().trim().max(6000),
    })
    .strict()
    .parse(raw);
  return transaction(async (db) => {
    const updated = await db.query(
      "UPDATE withdrawals SET status=$1,internal_note=$2,version=version+1,updated_at=now() WHERE id=$3 AND version=$4 RETURNING version",
      [data.status, data.note, id, data.version],
    );
    if (!updated.rowCount)
      throw new StoreError(
        "VERSION_CONFLICT",
        "Zgłoszenie zmieniło się. Odśwież stronę.",
        409,
      );
    await db.query(
      "INSERT INTO audit_log(actor_id,action,entity_id,data) VALUES($1,'withdrawal.updated',$2,$3)",
      [actor, id, JSON.stringify({ status: data.status, note: data.note })],
    );
    return { version: updated.rows[0].version };
  });
}
