import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, transaction } from "./db";
import { settingsSchema, type StoreSettings } from "./settings";
import { parcelSchema, type Parcel } from "../parcel";
import {
  apaczka,
  requireApaczka,
  apaczkaMode,
  parseApaczkaValuation,
  type ApaczkaOrder,
  type ApaczkaService,
} from "./apaczka";
import { StoreError } from "./errors";
import { audit } from "./admin";
import { shippingKind } from "../shipping";
import { requireApaczkaMutation } from "./apaczka";
import { tokenHash } from "./orders";

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
    parcels: z.array(parcelSchema).min(1).max(20).optional(),
    presetId: z.string().max(60).optional(),
    pickupDate: dateSchema.optional(),
    quoteId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (p) => [p.parcel, p.parcels, p.presetId].filter(Boolean).length === 1,
    "Podaj paczki albo wybierz zapisany szablon.",
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
  parcel: Parcel | Parcel[],
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
    shipment: z
      .array(parcelSchema)
      .min(1)
      .max(20)
      .parse(Array.isArray(parcel) ? parcel : [parcel])
      .map((p) => ({
        dimension1: p.lengthCm,
        dimension2: p.widthCm,
        dimension3: p.heightCm,
        weight: p.weightKg,
        is_nstd: 0,
        shipment_type_code: "PACZKA",
      })),
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
  mode: "sandbox" | "live" | "unknown";
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
        "SELECT id,mode,provider_order_id,service_name,waybill_number,status FROM shipments WHERE order_id=$1 AND status='created' AND mode IN ($2,'unknown') ORDER BY created_at DESC LIMIT 1",
        [id, apaczkaMode()],
      )
    ).rows[0] || null
  );
}
export async function shipmentPending(id: string) {
  return (
    (
      await query(
        "SELECT 1 FROM order_events WHERE order_id=$1 AND kind IN ('shipment_pending','shipment_cancel_pending') AND (data->>'mode' IS NULL OR data->>'mode'=$2)",
        [id, apaczkaMode()],
      )
    ).rowCount !== 0
  );
}
type Client = typeof apaczka;
async function prepareShipment(
  db: PoolClient,
  id: string,
  input: z.infer<typeof shipmentInput>,
  service: ApaczkaService,
) {
  const o = (
    await db.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [id])
  ).rows[0];
  if (!o) throw new StoreError("NOT_FOUND", "Nie znaleziono zamówienia.", 404);
  if (
    o.legacy_id ||
    !["paid", "processing"].includes(o.status) ||
    !o.stock_committed
  )
    throw new StoreError(
      "SHIPMENT_ORDER",
      "Nie można nadać przesyłki dla tego zamówienia.",
      409,
    );
  if (
    (
      await db.query(
        "SELECT 1 FROM shipments WHERE order_id=$1 AND status='created' AND mode IN ($2,'unknown')",
        [id, apaczkaMode()],
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
        "SELECT 1 FROM order_events WHERE order_id=$1 AND kind IN ('shipment_pending','shipment_cancel_pending') AND (data->>'mode' IS NULL OR data->>'mode'=$2)",
        [id, apaczkaMode()],
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
  if (
    (
      await db.query(
        "SELECT 1 FROM order_events WHERE order_id=$1 AND kind IN ('record_return','record_refund')",
        [id],
      )
    ).rowCount
  )
    throw new StoreError(
      "SHIPMENT_ADJUSTED_ORDER",
      "Zamówienie ma zapisany zwrot lub przyjęcie towaru. Wyjaśnij rozliczenie i zakres wysyłki przed nadaniem.",
      409,
    );
  const snapshot = (
    await db.query(
      "SELECT data->'shipping'->>'kind' AS kind FROM order_events WHERE order_id=$1 AND kind='created' ORDER BY created_at LIMIT 1",
      [id],
    )
  ).rows[0]?.kind as "courier" | "pickup" | undefined;
  const method = settings.shippingMethods.find(
    (m) => m.id === o.shipping_method,
  );
  if (
    shippingKind({
      id: o.shipping_method,
      kind: snapshot || method?.kind,
    }) === "pickup"
  )
    throw new StoreError(
      "SHIPMENT_PICKUP_ORDER",
      "Zamówienie z odbiorem osobistym nie wymaga przesyłki kurierskiej.",
      409,
    );
  const parcels = z
    .array(parcelSchema)
    .min(1)
    .max(20)
    .parse(
      input.parcels || [
        input.parcel ||
          settings.parcelPresets.find((p) => p.id === input.presetId),
      ],
    );
  const order = mapShipmentOrder(
    o,
    settings,
    service,
    parcels,
    input.pickupDate,
  );
  return { order, parcel: parcels };
}
function quoteFingerprint(order: ApaczkaOrder) {
  // Pickup hours are refreshed at send time; date and all commercial inputs stay bound.
  const { hours_from, hours_to, ...pickup } = order.pickup;
  return tokenHash(
    JSON.stringify({ order: { ...order, pickup }, mode: apaczkaMode() }),
  );
}
export async function quoteShipment(
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
  const prepared = await transaction((db) =>
    prepareShipment(db, id, input, service),
  );
  if (input.pickupDate)
    Object.assign(
      prepared.order.pickup,
      await client.pickupHours(
        prepared.order.address.sender.postal_code,
        service.service_id,
        input.pickupDate,
      ),
    );
  const price = parseApaczkaValuation(
    await client.valuation(prepared.order),
    service.service_id,
  );
  const fingerprint = quoteFingerprint(prepared.order);
  const quoteId = randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  await transaction(async (db) => {
    const current = await prepareShipment(db, id, input, service);
    if (quoteFingerprint(current.order) !== fingerprint)
      throw new StoreError(
        "SHIPMENT_QUOTE_CHANGED",
        "Dane zamówienia zmieniły się. Pobierz nową wycenę.",
        409,
      );
    await db.query(
      "INSERT INTO order_events(order_id,event_key,kind,actor_id,data) VALUES($1,$2,'shipment_quoted',$3,$4)",
      [
        id,
        quoteId,
        actor,
        JSON.stringify({ fingerprint, expiresAt, ...price }),
      ],
    );
  });
  return {
    quoteId,
    expiresAt,
    ...price,
    mode: apaczkaMode(),
    parcelsCount: prepared.parcel.length,
  };
}
export async function createShipment(
  id: string,
  raw: unknown,
  actor: string,
  client: Client = apaczka,
) {
  requireApaczkaMutation();
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
    const { order, parcel } = await prepareShipment(db, id, input, service);
    if (input.quoteId || apaczkaMode() === "live") {
      const quote = input.quoteId
        ? (
            await db.query(
              "SELECT data FROM order_events WHERE order_id=$1 AND event_key=$2 AND actor_id=$3 AND kind='shipment_quoted'",
              [id, input.quoteId, actor],
            )
          ).rows[0]?.data
        : null;
      if (
        !quote ||
        Date.parse(quote.expiresAt) <= Date.now() ||
        quote.fingerprint !== quoteFingerprint(order)
      )
        throw new StoreError(
          "SHIPMENT_QUOTE_REQUIRED",
          "Przed nadaniem pobierz i zatwierdź aktualną wycenę dla tych paczek.",
          409,
        );
    }
    await db.query(
      "INSERT INTO order_events(order_id,event_key,kind,actor_id,data) VALUES($1,$2,'shipment_pending',$3,$4)",
      [
        id,
        attempt,
        actor,
        JSON.stringify({ serviceId: service.service_id, mode: apaczkaMode() }),
      ],
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
        [
          "APACZKA_REJECTED",
          "APACZKA_DISABLED",
          "APACZKA_LIVE_DISABLED",
          "APACZKA_MODE",
        ].includes(error.code))
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
          "INSERT INTO shipments(order_id,provider_order_id,service_id,service_name,waybill_number,parcel,cod_cents,created_by,mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,mode,provider_order_id,service_name,waybill_number,status",
          [
            id,
            sent.apaczkaOrderId,
            service.service_id,
            service.name,
            sent.waybillNumber || null,
            JSON.stringify(prepared.parcel),
            prepared.order.cod?.amount ?? null,
            actor,
            apaczkaMode(),
          ],
        )
      ).rows[0];
      if (shipment.mode === "live")
        await db.query(
          "UPDATE orders SET tracking_number=$2,updated_at=now() WHERE id=$1",
          [id, sent.waybillNumber || null],
        );
      const data = {
        mode: apaczkaMode(),
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
  requireApaczkaMutation();
  z.uuid().parse(id);
  const attempt = randomUUID();
  const s = await transaction(async (db) => {
    await db.query("SELECT id FROM orders WHERE id=$1 FOR UPDATE", [id]);
    const shipment = (
      await db.query(
        "SELECT * FROM shipments WHERE order_id=$1 AND status='created' AND mode IN ($2,'unknown') FOR UPDATE",
        [id, apaczkaMode()],
      )
    ).rows[0];
    if (!shipment)
      throw new StoreError("SHIPMENT_MISSING", "Brak aktywnej przesyłki.", 404);
    if (shipment.mode !== apaczkaMode())
      throw new StoreError(
        "SHIPMENT_MODE",
        "Najpierw potwierdź tryb tej przesyłki u operatora. Nie można anulować zlecenia z innego środowiska.",
        409,
      );
    if (
      (
        await db.query(
          "SELECT 1 FROM order_events WHERE order_id=$1 AND kind='shipment_cancel_pending' AND (data->>'mode' IS NULL OR data->>'mode'=$2)",
          [id, apaczkaMode()],
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
      [
        id,
        attempt,
        actor,
        JSON.stringify({ shipmentId: shipment.id, mode: shipment.mode }),
      ],
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
      if (s.mode === "live")
        await db.query(
          "UPDATE orders SET tracking_number=NULL,updated_at=now() WHERE id=$1 AND tracking_number=$2",
          [id, s.waybill_number],
        );
      await db.query(
        "UPDATE order_events SET kind='shipment_cancelled',data=$2 WHERE event_key=$1",
        [
          attempt,
          JSON.stringify({
            shipmentId: s.id,
            reference: s.waybill_number,
            mode: s.mode,
          }),
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
  if (s.mode !== apaczkaMode())
    throw new StoreError(
      "SHIPMENT_MODE",
      "Najpierw potwierdź tryb tej przesyłki u operatora. Nie można pobrać etykiety z innego środowiska.",
      409,
    );
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
        if (updated.rowCount && s.mode === "live")
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
