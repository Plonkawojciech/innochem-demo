import { HomeContent } from "@/components/HomeContent";
import { requestSite } from "@/lib/server/site-request";
import { products } from "@/lib/server/catalog";
export default async function Home() {
  const { content } = await requestSite();
  const series = content.home.featured.label.replace(/^seria\s+/i, "").trim();
  const seriesProducts =
    content.home.featured.enabled && series
      ? (await products({ search: series, page: 1 })).items.filter(
          (p) => p.saleMode === "retail",
        )
      : [];
  return (
    <main>
      <HomeContent
        home={content.home}
        series={series}
        seriesProducts={seriesProducts}
      />
    </main>
  );
}
