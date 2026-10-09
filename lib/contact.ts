/** Keep storefront helpers independent of the server-side CMS schemas. */
export function phoneHref(phone: string) {
  return `tel:${phone.replace(/[^+0-9]/g, "")}`;
}
