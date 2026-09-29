import Link from "next/link";

export function Breadcrumbs({
  items,
}: {
  items: { name: string; path: string }[];
}) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: new URL(item.path, process.env.APP_URL || "https://innochem.pl")
        .href,
    })),
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <nav className="crumbs" aria-label="Ścieżka nawigacji">
        {items.map((item, index) => (
          <span key={item.path}>
            {index > 0 && " / "}
            {index === items.length - 1 ? (
              <span aria-current="page">{item.name}</span>
            ) : (
              <Link href={item.path}>{item.name}</Link>
            )}
          </span>
        ))}
      </nav>
    </>
  );
}
