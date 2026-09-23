import { InquiryForm } from "@/components/InquiryForm";
import { ContactContent } from "@/components/ContactContent";
import { requestSite } from "@/lib/server/site-request";
export async function generateMetadata() {
  const { content: c } = await requestSite();
  return {
    title: `${c.industryPage.title} — ${c.brand.name}`,
    description: c.industryPage.metaDescription,
    alternates: { canonical: "/przemysl" },
  };
}
export default async function Industry({
  searchParams,
}: {
  searchParams: Promise<{ dzial?: string }>;
}) {
  const [{ dzial }, { content: c }] = await Promise.all([
    searchParams,
    requestSite(),
  ]);
  const subject =
    c.industryPage.departments.find((d) => d.key === dzial)?.name ||
    c.industryPage.subject;
  return (
    <main className="wrap contact-page">
      <ContactContent page={c.industryPage} contact={c.contact}>
        <ul className="industry-list">
          {c.industryPage.departments.map((d, i) => (
            <li key={i}>{d.name}</li>
          ))}
        </ul>
      </ContactContent>
      <InquiryForm
        key={subject}
        subject={subject}
        preview={process.env.STOREFRONT_PREVIEW !== "false"}
      />
    </main>
  );
}
