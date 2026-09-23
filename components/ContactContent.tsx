import { phoneHref, type SiteContent } from "@/lib/site-content";
export function ContactContent({
  page,
  contact,
  company = false,
  children,
}: {
  page: SiteContent["contactPage"];
  contact: SiteContent["contact"];
  company?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="contact-copy">
      <p className="label">{page.label}</p>
      <h1 className="display">{page.title}</h1>
      {page.image.path && (
        <img
          className="contact-image"
          src={page.image.path}
          alt={page.image.alt}
        />
      )}
      <div
        className="prose"
        dangerouslySetInnerHTML={{ __html: page.bodyHtml }}
      />
      {children}
      <a className="contact-phone" href={phoneHref(contact.phone)}>
        {contact.phone}
      </a>
      <a href={`mailto:${contact.email}`}>{contact.email}</a>
      {company && (
        <>
          <address className="preserve-lines">
            {contact.company}
            <br />
            {contact.address}
          </address>
          <p>
            {contact.hours}
            <br />
            {contact.nip && `NIP ${contact.nip}`}{" "}
            {contact.regon && ` · REGON ${contact.regon}`}
          </p>
        </>
      )}
    </div>
  );
}
