export function stripeConfigured() {
  const mode = process.env.STRIPE_MODE;
  return (
    (mode === "test" || mode === "live") &&
    !!process.env.STRIPE_SECRET_KEY?.startsWith(`sk_${mode}_`) &&
    !!process.env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")
  );
}
export function stripeCheckoutReady() {
  return (
    stripeConfigured() &&
    process.env.PAYMENTS_ENABLED === "true" &&
    (process.env.STOREFRONT_PREVIEW === "false" ||
      (process.env.STRIPE_MODE === "test" &&
        process.env.STRIPE_TEST_CHECKOUT_ENABLED === "true"))
  );
}
