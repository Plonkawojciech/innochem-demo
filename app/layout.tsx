import type { Metadata } from "next";
import { Manrope, Inter, IBM_Plex_Mono } from "next/font/google";
import { CartProvider } from "@/lib/cart";
import {
  PreviewBar,
  CmsPreviewBar,
  Header,
  CatBar,
  Footer,
} from "@/components/SiteChrome";
import "./globals.css";
import { requestSite } from "@/lib/server/site-request";
import { themeBootScript } from "@/components/ThemeToggle";

const archivo = Manrope({
  subsets: ["latin-ext"],
  weight: ["600", "700", "800"],
  variable: "--f-display",
});
const inter = Inter({ subsets: ["latin-ext"], variable: "--f-body" });
const mono = IBM_Plex_Mono({
  subsets: ["latin-ext"],
  weight: ["400", "500", "700"],
  variable: "--f-mono",
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
        <CartProvider>
          {process.env.STOREFRONT_PREVIEW !== "false" && <PreviewBar />}
          {draft && <CmsPreviewBar />}
          <Header brand={content.brand} navigation={content.navigation} />
          <CatBar navigation={content.navigation} />
          {children}
          <Footer
            brand={content.brand}
            contact={content.contact}
            footer={content.footer}
          />
        </CartProvider>
      </body>
    </html>
  );
}
