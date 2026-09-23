import { InquiryForm } from "@/components/InquiryForm";
import { ContactContent } from "@/components/ContactContent";
import { requestSite } from "@/lib/server/site-request";
export async function generateMetadata() {
  const { content: c } = await requestSite();
  return {
    title: `${c.distributorsPage.title} — ${c.brand.name}`,
    description: c.distributorsPage.metaDescription,
    alternates: { canonical: "/dystrybutorzy" },
  };
}
export default async function Distributors() {
  const { content: c } = await requestSite();
  return (
    <main className="wrap contact-page">
      <ContactContent page={c.distributorsPage} contact={c.contact} />
      <InquiryForm
        subject={c.distributorsPage.subject}
        preview={process.env.STOREFRONT_PREVIEW !== "false"}
      />
    </main>
  );
}
