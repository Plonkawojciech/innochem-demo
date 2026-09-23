import type { MetadataRoute } from "next";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  if (process.env.STOREFRONT_PREVIEW !== "false")
    return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/admin", "/konto", "/zamowienie"],
    },
    sitemap: new URL(
      "/sitemap.xml",
      process.env.APP_URL || "https://innochem.pl",
    ).href,
  };
}
