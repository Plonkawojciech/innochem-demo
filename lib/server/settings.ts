import { z } from "zod";
import { query } from "./db";

export const shippingSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1).max(100),
  priceCents: z.number().int().min(0).max(100000),
  cod: z.boolean(),
  enabled: z.boolean(),
  maxWeightGrams: z.number().int().min(0).default(0),
});
export const settingsSchema = z.object({
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
