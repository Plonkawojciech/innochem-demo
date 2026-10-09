import { AddToCartPopup } from "@/components/AddToCartPopup";
import { Analytics } from "@/components/Analytics";
import { ConsentBanner } from "@/components/ConsentBanner";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { CartProvider } from "@/lib/cart";
import { CmsPreviewBar, Header, CatBar, Footer } from "@/components/SiteChrome";
import "./globals.css";
import "./fonts/extended.css";
import { requestSite } from "@/lib/server/site-request";
import { themeBootScript } from "@/components/ThemeToggle";

const archivo = localFont({
  src: "./fonts/manrope.woff2",
  weight: "600 800",
  variable: "--f-display",
  adjustFontFallback: false,
  fallback: ["InnochemDisplayExtended", "InnochemDisplayFallback"],
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0104-0107,U+0118-0119,U+0131,U+0141-0144,U+0152-0153,U+015A-015B,U+0179-017C,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-036F,U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+25BE,U+2713,U+FEFF,U+FFFD",
    },
  ],
});
const inter = localFont({
  src: "./fonts/inter.woff2",
  weight: "100 900",
  variable: "--f-body",
  adjustFontFallback: false,
  fallback: ["InnochemBodyExtended", "InnochemBodyFallback"],
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0104-0107,U+0118-0119,U+0131,U+0141-0144,U+0152-0153,U+015A-015B,U+0179-017C,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-036F,U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+25BE,U+2713,U+FEFF,U+FFFD",
    },
  ],
});
const mono = localFont({
  src: [
    { path: "./fonts/mono-400.woff2", weight: "400" },
    { path: "./fonts/mono-500.woff2", weight: "500" },
    { path: "./fonts/mono-700.woff2", weight: "700" },
  ],
  variable: "--f-mono",
  preload: false,
  // Arial is proportional; its generated fallback changes breadcrumb wrapping.
  adjustFontFallback: false,
  fallback: ["InnochemMonoExtended", "monospace"],
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF,U+0104-0107,U+0118-0119,U+0131,U+0141-0144,U+0152-0153,U+015A-015B,U+0179-017C,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-036F,U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+25BE,U+2713,U+FEFF,U+FFFD",
    },
  ],
});

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { content, draft } = await requestSite();
  return {
    metadataBase: new URL(process.env.APP_URL || "https://innochem.pl"),
    title: content.seo.title,
    description: content.seo.description,
    openGraph: {
      title: content.seo.title,
      description: content.seo.description,
      ...(content.seo.image.path
        ? {
            images: [
              { url: content.seo.image.path, alt: content.seo.image.alt },
            ],
          }
        : {}),
    },
    robots: {
      index: !draft && process.env.STOREFRONT_PREVIEW === "false",
      follow: !draft && process.env.STOREFRONT_PREVIEW === "false",
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { content, draft } = await requestSite();
  const url = process.env.APP_URL || "https://innochem.pl";
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "INNOCHEM Aneta Zalewska",
    url,
    ...(content.brand.logo.path
      ? { logo: new URL(content.brand.logo.path, url).href }
      : {}),
    telephone: content.contact.phone,
    email: content.contact.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: "ul. Okrzei 64/74",
      postalCode: "25-526",
      addressLocality: "Kielce",
      addressCountry: "PL",
    },
  };
  return (
    <html
      lang="pl"
      className={`${archivo.variable} ${inter.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organization).replace(/</g, "\\u003c"),
          }}
        />
        <a className="skip-link" href="#tresc">
          Przejdź do treści
        </a>
        <CartProvider>
          <Analytics />
          <ConsentBanner />
          {draft && <CmsPreviewBar />}
          <Header brand={content.brand} navigation={content.navigation} />
          <CatBar navigation={content.navigation} />
          <div id="tresc" tabIndex={-1}>
            {children}
          </div>
          <Footer
            brand={content.brand}
            contact={content.contact}
            footer={content.footer}
          />
          <AddToCartPopup />
        </CartProvider>
      </body>
    </html>
  );
}
