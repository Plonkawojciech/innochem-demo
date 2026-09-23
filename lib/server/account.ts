import { z } from "zod";
import { query, transaction } from "./db";
import { StoreError } from "./orders";
const name = z.string().trim().min(1).max(100);
export const profileSchema = z
  .object({
    version: z.number().int().positive(),
    firstName: name,
    lastName: name,
  })
  .strict();
export const addressSchema = z
  .object({
    version: z.number().int().positive().optional(),
    label: z.string().trim().min(1).max(80),
    data: z
      .object({
        firstName: name,
        lastName: name,
        company: z.string().trim().max(180).default(""),
        nip: z.string().trim().max(30).default(""),
        phone: z
          .string()
          .trim()
          .regex(/^[+\d\s()-]{0,25}$/)
          .default(""),
        street: z.string().trim().min(1).max(180),
        street2: z.string().trim().max(180).default(""),
        postalCode: z.string().trim().min(1).max(20),
        city: name,
        country: z.string().regex(/^[A-Z]{2}$/),
      })
      .strict()
      .refine(
        (d) => d.country !== "PL" || /^\d{2}-\d{3}$/.test(d.postalCode),
        "Polski kod pocztowy ma format 00-000.",
      ),
  })
  .strict();
export type CustomerAddress = z.infer<typeof addressSchema>["data"];
function conflict() {
  return new StoreError(
    "VERSION_CONFLICT",
    "Dane zmieniły się od otwarcia formularza. Odśwież stronę.",
    409,
  );
}
export async function saveProfile(customerId: string, raw: unknown) {
  z.uuid().parse(customerId);
  const p = profileSchema.parse(raw);
  return transaction(async (db) => {
    const {
      rows: [c],
    } = await db.query(
      "UPDATE customers SET first_name=$1,last_name=$2,version=version+1 WHERE id=$3 AND version=$4 RETURNING auth_user_id,version",
      [p.firstName, p.lastName, customerId, p.version],
    );
    if (!c) throw conflict();
    if (c.auth_user_id)
      await db.query(
        'UPDATE auth_user SET name=$1,"updatedAt"=now() WHERE id=$2',
        [[p.firstName, p.lastName].join(" "), c.auth_user_id],
      );
    return { version: c.version };
  });
}
export async function saveAddress(
  customerId: string,
  raw: unknown,
  addressId?: string,
) {
  z.uuid().parse(customerId);
  if (addressId) z.uuid().parse(addressId);
  const p = addressSchema.parse(raw);
  return transaction(async (db) => {
    const owner = await db.query(
      "SELECT id FROM customers WHERE id=$1 FOR UPDATE",
      [customerId],
    );
    if (!owner.rowCount)
      throw new StoreError("NOT_FOUND", "Nie znaleziono konta.", 404);
    if (addressId) {
      const {
        rows: [old],
      } = await db.query(
        "SELECT version,archived FROM addresses WHERE id=$1 AND customer_id=$2 FOR UPDATE",
        [addressId, customerId],
      );
      if (!old)
        throw new StoreError("NOT_FOUND", "Nie znaleziono adresu.", 404);
      if (old.version !== p.version) throw conflict();
      if (old.archived)
        throw new StoreError(
          "ADDRESS_ARCHIVED",
          "Przywróć adres przed edycją.",
          409,
        );
      const {
        rows: [saved],
      } = await db.query(
        "UPDATE addresses SET label=$1,data=$2,version=version+1 WHERE id=$3 AND customer_id=$4 RETURNING id,version",
        [p.label, JSON.stringify(p.data), addressId, customerId],
      );
      return saved as { id: string; version: number };
    }
    const {
      rows: [count],
    } = await db.query(
      "SELECT count(*)::int AS n FROM addresses WHERE customer_id=$1 AND NOT archived",
      [customerId],
    );
    if (count.n >= 50)
      throw new StoreError(
        "ADDRESS_LIMIT",
        "Możesz zapisać do 50 aktywnych adresów.",
      );
    const {
      rows: [saved],
    } = await db.query(
      "INSERT INTO addresses(customer_id,label,data) VALUES($1,$2,$3) RETURNING id,version",
      [customerId, p.label, JSON.stringify(p.data)],
    );
    return saved as { id: string; version: number };
  });
}
export async function archiveAddress(
  customerId: string,
  addressId: string,
  raw: unknown,
) {
  z.uuid().parse(customerId);
  z.uuid().parse(addressId);
  const p = z
    .object({ version: z.number().int().positive(), archived: z.boolean() })
    .strict()
    .parse(raw);
  return transaction(async (db) => {
    await db.query("SELECT id FROM customers WHERE id=$1 FOR UPDATE", [
      customerId,
    ]);
    const {
      rows: [old],
    } = await db.query(
      "SELECT version,archived FROM addresses WHERE id=$1 AND customer_id=$2 FOR UPDATE",
      [addressId, customerId],
    );
    if (!old) throw new StoreError("NOT_FOUND", "Nie znaleziono adresu.", 404);
    if (old.version !== p.version) throw conflict();
    if (old.archived && !p.archived) {
      const {
        rows: [count],
      } = await db.query(
        "SELECT count(*)::int AS n FROM addresses WHERE customer_id=$1 AND NOT archived",
        [customerId],
      );
      if (count.n >= 50)
        throw new StoreError(
          "ADDRESS_LIMIT",
          "Najpierw zarchiwizuj jeden z aktywnych adresów.",
        );
    }
    const {
      rows: [saved],
    } = await db.query(
      "UPDATE addresses SET archived=$1,version=version+1 WHERE id=$2 AND customer_id=$3 RETURNING id,version",
      [p.archived, addressId, customerId],
    );
    return saved;
  });
}
export async function accountOverview(customerId: string, page = 1) {
  z.uuid().parse(customerId);
  page = Math.max(1, Math.min(100000, Math.floor(page) || 1));
  const [
    {
      rows: [profile],
    },
    { rows: addresses },
    { rows: orders },
    {
      rows: [count],
    },
  ] = await Promise.all([
    query(
      "SELECT first_name,last_name,email,version FROM customers WHERE id=$1",
      [customerId],
    ),
    query(
      "SELECT id,label,data,archived,version FROM addresses WHERE customer_id=$1 ORDER BY archived,label,id",
      [customerId],
    ),
    query(
      "SELECT id,number,legacy_id,status,source_data->>'statusName' AS legacy_status,total_cents,currency,created_at FROM orders WHERE customer_id=$1 ORDER BY created_at DESC,id LIMIT 25 OFFSET $2",
      [customerId, (page - 1) * 25],
    ),
    query("SELECT count(*)::int AS total FROM orders WHERE customer_id=$1", [
      customerId,
    ]),
  ]);
  return { profile, addresses, orders, total: count.total as number, page };
}
