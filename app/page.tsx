import { HomeContent } from "@/components/HomeContent";
import { requestSite } from "@/lib/server/site-request";
export default async function Home() {
  const { content } = await requestSite();
  return (
    <main>
      <HomeContent home={content.home} />
    </main>
  );
}
