import { z } from "zod";
import { query } from "./db";
import { parcelSchema } from "../parcel";
import { defaultSiteContent } from "../site-content";

export const shippingSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1).max(100),
  priceCents: z.number().int().min(0).max(100000),
  cod: z.boolean(),
  enabled: z.boolean(),
  maxWeightGrams: z.number().int().min(0).default(0),
});
export const senderSchema = z.object({
  name: z.string().trim().min(1).max(180),
  contactPerson: z.string().trim().min(1).max(180),
  street: z.string().trim().min(1).max(180),
  postalCode: z.string().regex(/^\d{2}-\d{3}$/),
  city: z.string().trim().min(1).max(100),
  phone: z
    .string()
    .trim()
    .regex(/^[+\d\s()-]{9,25}$/),
  email: z.email(),
});
export const defaultSender = {
  name: "INNOCHEM Aneta Zalewska",
  contactPerson: "Aneta Zalewska",
  street: "ul. Okrzei 64/74",
  postalCode: "25-526",
  city: "Kielce",
  phone: defaultSiteContent.contact.phone,
  email: defaultSiteContent.contact.email,
};
export const defaultParcelPresets = [
  {
    id: "karton-4",
    label: "Karton 4 butelki",
    lengthCm: 30,
    widthCm: 20,
    heightCm: 25,
    weightKg: 5,
  },
];
export const settingsSchema = z.object({
  sender: senderSchema.default(defaultSender),
  parcelPresets: z
    .array(
      parcelSchema.extend({
        id: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(60),
        label: z.string().trim().min(1).max(100),
      }),
    )
    .min(1)
    .max(20)
    .refine(
      (p) => new Set(p.map((x) => x.id)).size === p.length,
      "Identyfikatory paczek muszą być różne.",
    )
    .default(defaultParcelPresets),
  checkoutEnabled: z.boolean(),
  shippingApproved: z.boolean(),
  legalApproved: z.boolean(),
  termsVersion: z.string().min(1).max(80),
  shippingMethods: z.array(shippingSchema).max(20),
  paymentMethods: z.array(z.enum(["bank_transfer", "cod", "stripe"])),
  bankAccount: z.string().max(80),
  orderEmail: z.email(),
  contactEmail: z.email(),
});
export type StoreSettings = z.infer<typeof settingsSchema>;
export async function storeSettings(): Promise<StoreSettings> {
  const { rows } = await query("SELECT value FROM settings WHERE key='store'");
  return settingsSchema.parse(rows[0]?.value);
}
export function checkoutReady(settings: StoreSettings) {
  return (
    settings.checkoutEnabled &&
    settings.shippingApproved &&
    settings.legalApproved &&
    settings.termsVersion !== "pending" &&
    settings.shippingMethods.some((s) => s.enabled) &&
    settings.paymentMethods.length > 0
  );
}
