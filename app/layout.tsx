import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import { CartProvider } from "@/lib/cart";
import { DemoBar, Header } from "@/components/SiteChrome";
import "./globals.css";

const archivo = Space_Grotesk({ subsets: ["latin-ext"], weight: ["500", "700"], variable: "--f-display" });
const inter = Inter({ subsets: ["latin-ext"], variable: "--f-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin-ext"], weight: ["400", "500", "700"], variable: "--f-mono" });

export const metadata: Metadata = {
  title: "INNOCHEM — Oleje i smary Royal Purple | Wyłączny dystrybutor w Polsce",
  description:
    "Syntetyczne oleje silnikowe i przemysłowe Royal Purple. Oficjalna dystrybucja w Polsce — sklep internetowy INNOCHEM.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" className={`${archivo.variable} ${inter.variable} ${mono.variable}`}>
      <body>
        <CartProvider>
          <DemoBar />
          <Header />
          {children}
        </CartProvider>
      </body>
    </html>
  );
}
