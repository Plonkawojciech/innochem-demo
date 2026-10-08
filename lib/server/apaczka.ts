/** Apaczka Web API v2: https://api-docs.apaczka.pl/reference/v2-legacy/orders
 * Verified 2026-10-08. POST form field request contains JSON; routes include trailing slash.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { StoreError } from "./errors";

export function apaczkaMode() {
  const mode = process.env.APACZKA_MODE || "sandbox";
  if (mode !== "sandbox" && mode !== "live")
    throw new StoreError(
      "APACZKA_MODE",
      "Niepoprawny tryb integracji Apaczka.",
      503,
    );
  return mode;
}
export function requireApaczkaMutation() {
  requireApaczka();
  if (
    apaczkaMode() === "live" &&
    (process.env.STOREFRONT_PREVIEW !== "false" ||
      process.env.APACZKA_LIVE_SHIPPING_ENABLED !== "true")
  )
    throw new StoreError(
      "APACZKA_LIVE_DISABLED",
      "Nadania i anulowanie w produkcyjnej Apaczce są wyłączone. Sprawdź środowisko i zgodę na rzeczywiste zlecenie.",
      503,
    );
}

export function apaczkaConfigured() {
  return !!(
    process.env.APACZKA_APP_ID?.trim() && process.env.APACZKA_APP_SECRET?.trim()
  );
}
export function requireApaczka() {
  if (!apaczkaConfigured())
    throw new StoreError(
      "APACZKA_DISABLED",
      "Integracja Apaczka nie jest skonfigurowana.",
      503,
    );
}
export function apaczkaSignature(
  appId: string,
  route: string,
  request: string,
  expires: number,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(`${appId}:${route}:${request}:${expires}`)
    .digest("hex");
}
const identifier = z
  .union([z.string().min(1).max(180), z.number().int().nonnegative()])
  .transform(String);
const flag = z.union([z.string(), z.number()]).transform(String);
const serviceSchema = z.object({
  service_id: identifier,
  name: z.string().min(1),
  domestic: flag,
  door_to_door: flag,
  pickup_courier: z
    .union([
      z.literal("0"),
      z.literal("1"),
      z.literal("2"),
      z.literal(0),
      z.literal(1),
      z.literal(2),
    ])
    .transform(String),
});
export type ApaczkaService = z.infer<typeof serviceSchema>;
export function parseApaczkaValuation(raw: unknown, serviceId: string) {
  const parsed = z
    .object({
      price_table: z.record(
        z.string(),
        z.object({
          price: z.number().int().nonnegative(),
          price_gross: z.number().int().nonnegative(),
        }),
      ),
    })
    .safeParse(raw);
  const price = parsed.success ? parsed.data.price_table[serviceId] : undefined;
  if (!price)
    throw new StoreError(
      "APACZKA_VALUATION",
      "Brak poprawnej wyceny wybranej usługi. Nadanie nie zostało wykonane.",
      502,
    );
  return { netCents: price.price, grossCents: price.price_gross };
}
export type ApaczkaOrder = {
  service_id: number;
  address: { sender: ApaczkaAddress; receiver: ApaczkaAddress };
  shipment: {
    dimension1: number;
    dimension2: number;
    dimension3: number;
    weight: number;
    is_nstd: 0;
    shipment_type_code: "PACZKA";
  }[];
  pickup: {
    type: "SELF" | "COURIER";
    date?: string;
    hours_from?: string;
    hours_to?: string;
  };
  option: Record<string, number>;
  cod?: { amount: number; currency: "PLN"; bankaccount: string };
  shipment_value: number;
  shipment_currency: "PLN";
  content: string;
  comment: string;
  is_zebra: 0;
};
export type ApaczkaAddress = {
  country_code: string;
  name: string;
  line1: string;
  postal_code: string;
  city: string;
  is_residential: 0 | 1;
  contact_person: string;
  email: string;
  phone: string;
};
const ambiguous = () =>
  new StoreError(
    "APACZKA_UNCERTAIN",
    "Nie udało się potwierdzić wyniku operacji w Apaczce. Sprawdź zlecenie w panelu Apaczki przed kolejną próbą.",
    502,
  );
const pickupHoursSchema = z.object({
  hours: z.record(
    z.string(),
    z.object({
      services: z.array(
        z.object({
          service: identifier,
          timefrom: z.string().regex(/^\d{2}:\d{2}$/),
          timeto: z.string().regex(/^\d{2}:\d{2}$/),
        }),
      ),
    }),
  ),
});
export function createApaczkaClient(fetcher: typeof fetch = globalThis.fetch) {
  const pickupCache = new Map<
    string,
    { until: number; promise: Promise<z.infer<typeof pickupHoursSchema>> }
  >();
  let cached:
    { key: string; until: number; value: ApaczkaService[] } | undefined;
  let pending: { key: string; promise: Promise<ApaczkaService[]> } | undefined;
  async function request(route: string, data: unknown = []): Promise<unknown> {
    requireApaczka();
    const mode = apaczkaMode();
    if (
      route === "order_send/" ||
      route.startsWith("cancel_order/") ||
      route === "pickup/" ||
      route === "batch_pickup/"
    )
      requireApaczkaMutation();
    const base =
      mode === "sandbox"
        ? "https://panel-sandbox.apaczka.pl/api/v2/"
        : "https://www.apaczka.pl/api/v2/";
    const appId = process.env.APACZKA_APP_ID!;
    const secret = process.env.APACZKA_APP_SECRET!;
    const payload = JSON.stringify(data);
    const expires = Math.floor(Date.now() / 1000) + 300;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetcher(`${base}${route}`, {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          app_id: appId,
          request: payload,
          expires: String(expires),
          signature: apaczkaSignature(appId, route, payload, expires, secret),
        }),
      });
      if (!res.ok) throw ambiguous();
      const envelope = z
        .object({ status: z.number(), response: z.unknown() })
        .safeParse(await res.json());
      if (!envelope.success) throw ambiguous();
      if (envelope.data.status === 400)
        throw new StoreError(
          "APACZKA_REJECTED",
          "Apaczka odrzuciła operację. Sprawdź dane nadawcy, odbiorcy, paczki, usługę i saldo konta w panelu Apaczki.",
          422,
        );
      if (envelope.data.status !== 200) throw ambiguous();
      return envelope.data.response;
    } catch (error) {
      // Never log the request, response, provider message, credentials or recipient.
      if (error instanceof StoreError) throw error;
      throw ambiguous();
    } finally {
      clearTimeout(timer);
    }
  }
  async function services() {
    requireApaczka();
    const key = createHmac("sha256", process.env.APACZKA_APP_SECRET!)
      .update(`${apaczkaMode()}:${process.env.APACZKA_APP_ID}`)
      .digest("hex");
    if (cached?.key === key && cached.until > Date.now()) return cached.value;
    if (pending?.key === key) return pending.promise;
    const promise = (async () => {
      const parsed = z
        .object({ services: z.array(serviceSchema) })
        .safeParse(await request("service_structure/"));
      if (!parsed.success) throw ambiguous();
      cached = {
        key,
        until: Date.now() + 3600000,
        value: parsed.data.services,
      };
      return cached.value;
    })();
    pending = { key, promise };
    try {
      return await promise;
    } finally {
      if (pending?.promise === promise) pending = undefined;
    }
  }
  async function order(id: string) {
    const parsed = z
      .object({
        order: z.object({
          id: identifier,
          waybill_number: z.string().default(""),
          tracking_url: z.string().optional(),
          status: z.string().optional(),
        }),
      })
      .safeParse(await request(`order/${encodeURIComponent(id)}/`));
    if (!parsed.success) throw ambiguous();
    return parsed.data.order;
  }
  return {
    services,
    order,
    async pickupHours(postalCode: string, serviceId: string, date: string) {
      requireApaczka();
      const key = createHmac("sha256", process.env.APACZKA_APP_SECRET!)
        .update(
          `${apaczkaMode()}:${process.env.APACZKA_APP_ID}:${postalCode}:${serviceId}`,
        )
        .digest("hex");
      for (const [k, entry] of pickupCache)
        if (entry.until <= Date.now()) pickupCache.delete(k);
      let entry = pickupCache.get(key);
      if (!entry) {
        if (pickupCache.size >= 100)
          pickupCache.delete(pickupCache.keys().next().value!);
        const promise = (async () => {
          const parsed = pickupHoursSchema.safeParse(
            await request("pickup_hours/", {
              postal_code: postalCode,
              service_id: Number(serviceId),
              remove_index: false,
            }),
          );
          if (!parsed.success) throw ambiguous();
          return parsed.data;
        })();
        entry = { until: Date.now() + 1800000, promise };
        pickupCache.set(key, entry);
      }
      let data: z.infer<typeof pickupHoursSchema>;
      try {
        data = await entry.promise;
      } catch (error) {
        pickupCache.delete(key);
        throw error;
      }
      const slot = data.hours[date]?.services.find(
        (s) => s.service === serviceId,
      );
      if (!slot)
        throw new StoreError(
          "APACZKA_PICKUP",
          "Brak odbioru kuriera dla wybranej daty i usługi. Wybierz inny dzień.",
        );
      return { hours_from: slot.timefrom, hours_to: slot.timeto };
    },
    async valuation(order: ApaczkaOrder) {
      return request("order_valuation/", { order });
    },
    async sendOrder(order: ApaczkaOrder) {
      const parsed = z
        .object({
          order: z.object({
            id: identifier,
            waybill_number: z.string().default(""),
            tracking_url: z.string().optional(),
          }),
        })
        .safeParse(await request("order_send/", { order }));
      if (!parsed.success) throw ambiguous();
      // A missing waybill can be asynchronous. Preserve the provider ID; never re-send.
      return {
        apaczkaOrderId: parsed.data.order.id,
        waybillNumber: parsed.data.order.waybill_number,
        trackingUrl: parsed.data.order.tracking_url,
      };
    },
    async waybillPdf(id: string) {
      const parsed = z
        .object({
          waybill: z.string().min(1).max(14000000),
          type: z.literal("pdf"),
        })
        .safeParse(await request(`waybill/${encodeURIComponent(id)}/`));
      if (!parsed.success)
        throw new StoreError(
          "APACZKA_LABEL",
          "Etykieta PDF nie jest jeszcze dostępna. Spróbuj pobrać ją później.",
          502,
        );
      const pdf = Buffer.from(parsed.data.waybill, "base64");
      if (pdf.subarray(0, 5).toString() !== "%PDF-")
        throw new StoreError(
          "APACZKA_LABEL",
          "Apaczka nie zwróciła poprawnego pliku PDF.",
          502,
        );
      return pdf;
    },
    async cancelOrder(id: string) {
      await request(`cancel_order/${encodeURIComponent(id)}/`);
    },
  };
}
export const apaczka = createApaczkaClient();
export const { services, valuation, sendOrder, waybillPdf, cancelOrder } =
  apaczka;
