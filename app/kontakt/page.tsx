import { InquiryForm } from "@/components/InquiryForm";
import { ContactContent } from "@/components/ContactContent";
import { requestSite } from "@/lib/server/site-request";
export async function generateMetadata() {
  const { content: c } = await requestSite();
  return {
    title: `${c.contactPage.title} — ${c.brand.name}`,
    description: c.contactPage.metaDescription,
    alternates: { canonical: "/kontakt" },
  };
}
export default async function Contact({
  searchParams,
}: {
  searchParams: Promise<{ produkt?: string }>;
}) {
  const [{ produkt }, { content: c }] = await Promise.all([
    searchParams,
    requestSite(),
  ]);
  return (
    <main className="wrap contact-page">
      <ContactContent page={c.contactPage} contact={c.contact} company />
      <InquiryForm
        subject={
          produkt ? `Produkt: ${produkt.slice(0, 180)}` : c.contactPage.subject
        }
        preview={process.env.STOREFRONT_PREVIEW !== "false"}
      />
    </main>
  );
}
