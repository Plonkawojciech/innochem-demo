import { z } from "zod";
import { randomUUID } from "node:crypto";
import { query, transaction } from "./db";
import { settingsSchema, type StoreSettings } from "./settings";
import { parcelSchema, type Parcel } from "../parcel";
import {
  apaczka,
  requireApaczka,
  type ApaczkaOrder,
  type ApaczkaService,
} from "./apaczka";
import { StoreError } from "./errors";
import { audit } from "./admin";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T12:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  });
export const shipmentInput = z
  .object({
    serviceId: z.string().regex(/^\d+$/).max(12),
    parcel: parcelSchema.optional(),
    presetId: z.string().max(60).optional(),
    pickupDate: dateSchema.optional(),
  })
  .strict()
  .refine(
    (p) => !!p.parcel !== !!p.presetId,
    "Wybierz paczkę lub podaj jej wymiary.",
  );
const recipientSchema = z.object({
  email: z.email(),
  currency: z.literal("PLN"),
  total_cents: z.number().int().nonnegative(),
  payment_method: z.string(),
  buyer: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    company: z.string().default(""),
    phone: z.string().min(1),
  }),
  shipping_address: z.object({
    street: z.string().min(1),
    postalCode: z.string().regex(/^\d{2}-\d{3}$/),
    city: z.string().min(1),
    country: z.literal("PL"),
  }),
});
export function mapShipmentOrder(
  raw: unknown,
  settings: StoreSettings,
  service: ApaczkaService,
  parcel: Parcel,
  pickupDate?: string,
): ApaczkaOrder {
  const parsed = recipientSchema.safeParse(raw);
  if (!parsed.success)
    throw new StoreError(
      "SHIPMENT_ADDRESS",
      "Uzupełnij poprawny polski adres i dane kontaktowe odbiorcy.",
    );
  const o = parsed.data,
    s = settings.sender;
  if (service.domestic !== "1" || service.door_to_door !== "1")
    throw new StoreError(
      "SHIPMENT_SERVICE",
      "Wybierz krajową usługę drzwi–drzwi.",
    );
  if (
    (service.pickup_courier === "2" && !pickupDate) ||
    (service.pickup_courier === "0" && pickupDate)
  )
    throw new StoreError(
      "SHIPMENT_PICKUP",
      "Sprawdź datę odbioru i możliwość zamówienia kuriera dla wybranej usługi.",
    );
  const phone = (value: string) => {
    const normalized = value.replace(/[\s()-]/g, "");
    if (!/^\+?\d{9,20}$/.test(normalized))
      throw new StoreError(
        "SHIPMENT_PHONE",
        "Sprawdź telefon nadawcy i odbiorcy (co najmniej 9 cyfr).",
      );
    return normalized;
  };
  const bankaccount = settings.bankAccount
    .replace(/\s/g, "")
    .replace(/^PL/i, "");
  if (o.payment_method === "cod" && !/^\d{26}$/.test(bankaccount))
    throw new StoreError(
      "SHIPMENT_BANK",
      "Dla pobrania wpisz w Ustawieniach sklepu polski numer rachunku (26 cyfr).",
    );
  const name = `${o.buyer.firstName} ${o.buyer.lastName}`;
  return {
    service_id: Number(service.service_id),
    address: {
      sender: {
        country_code: "PL",
        name: s.name,
        contact_person: s.contactPerson,
        line1: s.street,
        postal_code: s.postalCode,
        city: s.city,
        phone: phone(s.phone),
        email: s.email,
        is_residential: 0,
      },
      receiver: {
        country_code: o.shipping_address.country,
        name: o.buyer.company || name,
        contact_person: name,
        line1: o.shipping_address.street,
        postal_code: o.shipping_address.postalCode,
        city: o.shipping_address.city,
        phone: phone(o.buyer.phone),
        email: o.email,
        is_residential: o.buyer.company ? 0 : 1,
      },
    },
    shipment: [
      {
        dimension1: parcel.lengthCm,
        dimension2: parcel.widthCm,
        dimension3: parcel.heightCm,
        weight: parcel.weightKg,
        is_nstd: 0,
        shipment_type_code: "PACZKA",
      },
    ],
    ...(o.payment_method === "cod"
      ? {
          cod: { amount: o.total_cents, currency: "PLN" as const, bankaccount },
        }
      : {}),
    pickup: pickupDate
      ? { type: "COURIER", date: pickupDate }
      : { type: "SELF" },
    option: {},
    shipment_value: o.total_cents,
    shipment_currency: "PLN",
    content: "Produkty INNOCHEM",
    comment: "",
    is_zebra: 0,
  };
}
export type Shipment = {
  id: string;
  provider_order_id: string;
  service_name: string;
  waybill_number: string | null;
  status: "created" | "cancelled";
};
export async function activeShipment(id: string): Promise<Shipment | null> {
  z.uuid().parse(id);
  return (
    (
      await query<Shipment>(
        "SELECT id,provider_order_id,service_name,waybill_number,status FROM shipments WHERE order_id=$1 AND status='created'",
        [id],
      )
    ).rows[0] || null
  );
}
export async function shipmentPending(id: string) {
  return (
    (
      await query(
        "SELECT 1 FROM order_events WHERE order_id=$1 AND kind IN ('shipment_pending','shipment_cancel_pending')",
        [id],
      )
    ).rowCount !== 0
  );
}
type Client = typeof apaczka;
export async function createShipment(
  id: string,
  raw: unknown,
  actor: string,
  client: Client = apaczka,
) {
  requireApaczka();
  z.uuid().parse(id);
  const input = shipmentInput.parse(raw);
  const service = (await client.services()).find(
    (s) => s.service_id === input.serviceId,
  );
  if (!service)
    throw new StoreError(
      "SHIPMENT_SERVICE",
      "Wybrana usługa Apaczki nie jest dostępna.",
    );
  const attempt = randomUUID();
  const prepared = await transaction(async (db) => {
    const o = (
      await db.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!o)
      throw new StoreError("NOT_FOUND", "Nie znaleziono zamówienia.", 404);
    if (o.legacy_id || ["cancelled", "legacy", "refunded"].includes(o.status))
      throw new StoreError(
        "SHIPMENT_ORDER",
        "Nie można nadać przesyłki dla tego zamówienia.",
        409,
      );
    if (
      (
        await db.query(
          "SELECT 1 FROM shipments WHERE order_id=$1 AND status='created'",
          [id],
        )
      ).rowCount
    )
      throw new StoreError(
        "SHIPMENT_EXISTS",
        "Zamówienie ma już aktywną przesyłkę.",
        409,
      );
    if (
      (
        await db.query(
          "SELECT 1 FROM order_events WHERE order_id=$1 AND kind IN ('shipment_pending','shipment_cancel_pending')",
          [id],
        )
      ).rowCount
    )
      throw new StoreError(
        "SHIPMENT_PENDING",
        "Poprzednie nadanie oczekuje na potwierdzenie. Sprawdź zlecenie w Apaczce; nie nadawaj ponownie.",
        409,
      );
    const settings = settingsSchema.parse(
      (await db.query("SELECT value FROM settings WHERE key='store'")).rows[0]
        ?.value,
    );
    const parcel = parcelSchema.parse(
      input.parcel ||
        settings.parcelPresets.find((p) => p.id === input.presetId),
    );
    const order = mapShipmentOrder(
      o,
      settings,
      service,
      parcel,
      input.pickupDate,
    );
    await db.query(
      "INSERT INTO order_events(order_id,event_key,kind,actor_id,data) VALUES($1,$2,'shipment_pending',$3,$4)",
      [id, attempt, actor, JSON.stringify({ serviceId: service.service_id })],
    );
    await audit(db, actor, "shipment.requested", id, {
      attempt,
      serviceId: service.service_id,
    });
    return { order, parcel };
  });
  let sent: Awaited<ReturnType<Client["sendOrder"]>>;
  let submitted = false;
  try {
    if (input.pickupDate)
      Object.assign(
        prepared.order.pickup,
        await client.pickupHours(
          prepared.order.address.sender.postal_code,
          service.service_id,
          input.pickupDate,
        ),
      );
    submitted = true;
    sent = await client.sendOrder(prepared.order);
  } catch (error) {
    // Only explicit rejection or a failure BEFORE order_send permits another attempt.
    if (
      !submitted ||
      (error instanceof StoreError &&
        ["APACZKA_REJECTED", "APACZKA_DISABLED"].includes(error.code))
    ) {
      await transaction(async (db) => {
        await db.query(
          "UPDATE order_events SET kind='shipment_rejected' WHERE event_key=$1",
          [attempt],
        );
        await audit(db, actor, "shipment.rejected", id, { attempt });
      });
    }
    throw error;
  }
  try {
    return await transaction(async (db) => {
      await db.query("SELECT id FROM orders WHERE id=$1 FOR UPDATE", [id]);
      const shipment = (
        await db.query(
          "INSERT INTO shipments(order_id,provider_order_id,service_id,service_name,waybill_number,parcel,cod_cents,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,provider_order_id,service_name,waybill_number,status",
          [
            id,
            sent.apaczkaOrderId,
            service.service_id,
            service.name,
            sent.waybillNumber || null,
            JSON.stringify(prepared.parcel),
            prepared.order.cod?.amount ?? null,
            actor,
          ],
        )
      ).rows[0];
      await db.query(
        "UPDATE orders SET tracking_number=$2,updated_at=now() WHERE id=$1",
        [id, sent.waybillNumber || null],
      );
      const data = {
        shipmentId: shipment.id,
        providerOrderId: sent.apaczkaOrderId,
        reference: sent.waybillNumber,
      };
      await db.query(
        "UPDATE order_events SET kind='shipment_created',data=$2 WHERE event_key=$1",
        [attempt, JSON.stringify(data)],
      );
      await audit(db, actor, "shipment.created", id, data);
      return shipment;
    });
  } catch {
    // The durable pending event survives rollback. Do not repeat the remote mutation.
    throw new StoreError(
      "SHIPMENT_SAVE_UNCERTAIN",
      `Apaczka przyjęła zlecenie ${sent.apaczkaOrderId}, ale zapis lokalny wymaga sprawdzenia. Nie nadawaj ponownie.`,
      502,
    );
  }
}
export async function cancelShipment(
  id: string,
  actor: string,
  client: Client = apaczka,
) {
  requireApaczka();
  z.uuid().parse(id);
  const attempt = randomUUID();
  const s = await transaction(async (db) => {
    await db.query("SELECT id FROM orders WHERE id=$1 FOR UPDATE", [id]);
    const shipment = (
      await db.query(
        "SELECT * FROM shipments WHERE order_id=$1 AND status='created' FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!shipment)
      throw new StoreError("SHIPMENT_MISSING", "Brak aktywnej przesyłki.", 404);
    if (
      (
        await db.query(
          "SELECT 1 FROM order_events WHERE order_id=$1 AND kind='shipment_cancel_pending'",
          [id],
        )
      ).rowCount
    )
      throw new StoreError(
        "SHIPMENT_PENDING",
        "Anulowanie oczekuje na wyjaśnienie. Sprawdź stan zlecenia w Apaczce.",
        409,
      );
    await db.query(
      "INSERT INTO order_events(order_id,event_key,kind,actor_id,data) VALUES($1,$2,'shipment_cancel_pending',$3,$4)",
      [id, attempt, actor, JSON.stringify({ shipmentId: shipment.id })],
    );
    await audit(db, actor, "shipment.cancel_requested", id, {
      shipmentId: shipment.id,
      attempt,
    });
    return shipment;
  });
  try {
    await client.cancelOrder(s.provider_order_id);
  } catch (error) {
    if (
      error instanceof StoreError &&
      ["APACZKA_REJECTED", "APACZKA_DISABLED"].includes(error.code)
    ) {
      await transaction(async (db) => {
        await db.query(
          "UPDATE order_events SET kind='shipment_cancel_rejected' WHERE event_key=$1",
          [attempt],
        );
        await audit(db, actor, "shipment.cancel_rejected", id, {
          shipmentId: s.id,
        });
      });
    }
    throw error;
  }
  try {
    return await transaction(async (db) => {
      await db.query("SELECT id FROM orders WHERE id=$1 FOR UPDATE", [id]);
      await db.query(
        "UPDATE shipments SET status='cancelled',cancelled_at=now() WHERE id=$1",
        [s.id],
      );
      await db.query(
        "UPDATE orders SET tracking_number=NULL,updated_at=now() WHERE id=$1 AND tracking_number=$2",
        [id, s.waybill_number],
      );
      await db.query(
        "UPDATE order_events SET kind='shipment_cancelled',data=$2 WHERE event_key=$1",
        [
          attempt,
          JSON.stringify({ shipmentId: s.id, reference: s.waybill_number }),
        ],
      );
      await audit(db, actor, "shipment.cancelled", id, { shipmentId: s.id });
      return { status: "cancelled" as const };
    });
  } catch {
    throw new StoreError(
      "SHIPMENT_SAVE_UNCERTAIN",
      "Apaczka potwierdziła anulowanie, ale zapis lokalny wymaga sprawdzenia. Nie ponawiaj operacji.",
      502,
    );
  }
}
export async function shipmentLabel(
  id: string,
  actor: string,
  client: Client = apaczka,
) {
  requireApaczka();
  const s = await activeShipment(id);
  if (!s)
    throw new StoreError("SHIPMENT_MISSING", "Brak aktywnej przesyłki.", 404);
  const pdf = await client.waybillPdf(s.provider_order_id);
  await transaction(async (db) => {
    // Some carriers assign a waybill after accepting the order.
    if (!s.waybill_number) {
      const details = await client.order(s.provider_order_id);
      if (details.waybill_number) {
        await db.query("SELECT id FROM orders WHERE id=$1 FOR UPDATE", [id]);
        const updated = await db.query(
          "UPDATE shipments SET waybill_number=$2 WHERE id=$1 AND status='created' RETURNING id",
          [s.id, details.waybill_number],
        );
        if (updated.rowCount)
          await db.query(
            "UPDATE orders SET tracking_number=$2,updated_at=now() WHERE id=$1",
            [id, details.waybill_number],
          );
      }
    }
    await audit(db, actor, "shipment.label_downloaded", id, {
      shipmentId: s.id,
    });
  });
  return pdf;
}
