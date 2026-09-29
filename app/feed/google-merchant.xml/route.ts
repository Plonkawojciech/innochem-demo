import { merchantProducts } from "@/lib/server/catalog";
import { productFacts } from "@/lib/product-facts";
import { seoText } from "@/lib/server/seo-text";

export const dynamic = "force-dynamic";

function xml(value: string) {
  return value
    .replace(
      /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu,
      "",
    )
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
const tag = (name: string, value: string) => `<${name}>${xml(value)}</${name}>`;

export async function GET() {
  if (process.env.STOREFRONT_PREVIEW !== "false")
    return new Response(null, {
      status: 404,
      headers: { "X-Robots-Tag": "noindex", "Cache-Control": "no-store" },
    });

  const base = process.env.APP_URL;
  if (!base) throw new Error("APP_URL is required for the Merchant feed");
  const items = (await merchantProducts()).map((product) => {
    const image = product.imagePath ? new URL(product.imagePath, base) : null;
    if (image && product.imagePath!.startsWith("/media/"))
      image.searchParams.set("w", "960");
    const series = productFacts(product.name).series;
    return `<item>${[
      tag("g:id", product.sku || product.id),
      tag("title", product.name),
      tag(
        "description",
        Array.from(seoText(product.summary)).slice(0, 5000).join(""),
      ),
      tag("link", new URL(`/produkt/${product.slug}`, base).href),
      image ? tag("g:image_link", image.href) : "",
      tag(
        "g:availability",
        product.available > 0 ? "in_stock" : "out_of_stock",
      ),
      tag("g:price", `${(product.priceCents / 100).toFixed(2)} PLN`),
      tag("g:condition", "new"),
      tag("g:brand", "Royal Purple"),
      product.sku ? tag("g:mpn", product.sku) : "",
      series ? tag("g:product_type", series) : "",
    ].join("")}</item>`;
  });
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>${tag("title", "INNOCHEM — Royal Purple")}${tag("link", new URL("/", base).href)}${tag("description", "Produkty Royal Purple INNOCHEM")}${items.join("")}</channel></rss>`,
    {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=900",
      },
    },
  );
}
