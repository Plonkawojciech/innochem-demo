import { storeSettings, checkoutReady } from "@/lib/server/settings";
import { Checkout } from "./Checkout";
import { headers } from "next/headers";
import { customerForSession } from "@/lib/server/auth";
import { stripeCheckoutReady } from "@/lib/server/stripe-config";
import { query } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Koszyk i zamówienie — INNOCHEM",
  robots: { index: false, follow: false },
};
export default async function OrderPage() {
  const settings = await storeSettings();
  const customerId = await customerForSession(await headers());
  const profile = customerId
    ? (
        await query(
          "SELECT first_name,last_name,email FROM customers WHERE id=$1",
          [customerId],
        )
      ).rows[0]
    : null;
  const addresses = customerId
    ? (
        await query(
          "SELECT id,label,data FROM addresses WHERE customer_id=$1 AND NOT archived AND data->>'country'='PL' ORDER BY label",
          [customerId],
        )
      ).rows
    : [];
  return (
    <Checkout
      shipping={settings.shippingMethods.filter((s) => s.enabled)}
      payments={settings.paymentMethods.filter(
        (p) => p !== "stripe" || stripeCheckoutReady(),
      )}
      termsVersion={settings.termsVersion}
      enabled={checkoutReady(settings)}
      account={
        profile
          ? {
              firstName: profile.first_name,
              lastName: profile.last_name,
              email: profile.email,
              addresses: addresses as {
                id: string;
                label: string;
                data: Record<string, string>;
              }[],
            }
          : null
      }
    />
  );
}
