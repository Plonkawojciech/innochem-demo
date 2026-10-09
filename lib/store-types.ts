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
  weightGrams?: number;
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
/** The card, popup and cart need no product descriptions or SEO payload. */
export type ProductCardData = Pick<
  StoreProduct,
  | "id"
  | "slug"
  | "name"
  | "sku"
  | "priceCents"
  | "taxRate"
  | "available"
  | "imagePath"
  | "imageAlt"
  | "saleMode"
>;
/** Project on the server before passing products through a client boundary. */
export function productCardData(p: StoreProduct): ProductCardData {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    sku: p.sku,
    priceCents: p.priceCents,
    taxRate: p.taxRate,
    available: p.available,
    imagePath: p.imagePath,
    imageAlt: p.imageAlt,
    saleMode: p.saleMode,
  };
}
const plnFormatter = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
});
export function money(cents: number, currency = "PLN") {
  const formatter =
    currency === "PLN"
      ? plnFormatter
      : new Intl.NumberFormat("pl-PL", { style: "currency", currency });
  return formatter.format(cents / 100);
}
