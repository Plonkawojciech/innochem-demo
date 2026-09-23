import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { StoreError } from "./errors";
import { plainText } from "./content";
import type { StoreSettings } from "./settings";
export const legalSlugs = [
  "regulamin",
  "polityka-prywatnosci",
  "zwroty-i-reklamacje",
  "dostawa-i-platnosci",
  "polityka-cookies",
];
export type LegalDocument = { slug: string; title: string; bodyHtml: string };
export function legalCommerce(s: StoreSettings) {
  return {
    shippingMethods: s.shippingMethods,
    paymentMethods: s.paymentMethods,
    bankAccount: s.bankAccount,
    orderEmail: s.orderEmail,
    contactEmail: s.contactEmail,
  };
}
export function legalHash(documents: LegalDocument[], commerce: unknown) {
  return createHash("sha256")
    .update(JSON.stringify({ documents, commerce }))
    .digest("hex");
}
export async function approveLegalVersion(
  db: PoolClient,
  s: StoreSettings,
  actor: string,
) {
  const { rows } = await db.query(
    "SELECT slug,title,body_html,published FROM pages WHERE slug=ANY($1::text[]) ORDER BY slug",
    [legalSlugs],
  );
  if (
    s.termsVersion === "pending" ||
    rows.length !== legalSlugs.length ||
    rows.some(
      (p) =>
        !p.published ||
        plainText(p.body_html).length < 100 ||
        /DO UZUPEŁNIENIA|DO ZATWIERDZENIA|\[UZUPEŁNIJ\]/i.test(p.body_html),
    )
  )
    throw new StoreError(
      "LEGAL_INCOMPLETE",
      "Uzupełnij i opublikuj wszystkie dokumenty przed zatwierdzeniem warunków sprzedaży.",
    );
  const documents: LegalDocument[] = rows.map((p) => ({
    slug: p.slug,
    title: p.title,
    bodyHtml: p.body_html,
  }));
  const commerce = legalCommerce(s),
    hash = legalHash(documents, commerce);
  const {
    rows: [existing],
  } = await db.query(
    "SELECT content_hash FROM legal_versions WHERE version=$1",
    [s.termsVersion],
  );
  if (existing && existing.content_hash !== hash)
    throw new StoreError(
      "LEGAL_VERSION_REUSED",
      "Ta wersja ma już zatwierdzoną treść. Nadaj nowy numer wersji.",
      409,
    );
  if (!existing)
    await db.query(
      "INSERT INTO legal_versions(version,documents,commerce,content_hash,approved_by) VALUES($1,$2,$3,$4,$5)",
      [
        s.termsVersion,
        JSON.stringify(documents),
        JSON.stringify(commerce),
        hash,
        actor,
      ],
    );
}
export function legalText(documents: LegalDocument[]) {
  return documents
    .map(
      (p) =>
        `${p.title}\n${plainText(p.bodyHtml.replace(/<\/(?:p|h[2-4]|li)>/g, "</p>\n"))}`,
    )
    .join("\n\n");
}
