export type StoreProduct = {
  id: string;
  slug: string;
  name: string;
  sku: string;
  summary: string;
  descriptionHtml: string;
  priceCents: number;
  taxRate: number;
  available: number;
  imagePath: string | null;
  imageAlt: string;
  saleMode: "retail" | "inquiry";
  categorySlugs: string[];
  metaTitle: string;
  metaDescription: string;
};
export type StoreCategory = {
  id: string;
  slug: string;
  name: string;
  descriptionHtml: string;
  parentId: string | null;
};
export function money(cents: number, currency = "PLN") {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency }).format(
    cents / 100,
  );
}
