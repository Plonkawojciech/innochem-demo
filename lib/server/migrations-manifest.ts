// Keep in sync with db/migrations; enforced by migrations-manifest.test.ts.
export const requiredMigrations = [
  "001_store.sql",
  "002_auth.sql",
  "003_integrity.sql",
  "004_admin.sql",
  "005_media_paths.sql",
  "006_customer_profiles.sql",
  "007_legal_versions.sql",
  "008_mail_delivery.sql",
  "009_site_content.sql",
  "010_stripe.sql",
  "011_redirect_activation.sql",
  "012_product_documents.sql",
  "013_withdrawals.sql",
  "014_analytics.sql",
  "015_shipments.sql",
] as const;
