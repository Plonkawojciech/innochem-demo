import { plainText } from "./content";

/** Strip markup, preserve word boundaries and decode entities for text/XML consumers. */
export function seoText(html: string) {
  return plainText(html.replace(/<(?:br\b[^>]*|\/(?:p|div|li|h[1-6]))>/gi, " "))
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, (entity) => {
      const named: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
        "&nbsp;": " ",
      };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const hex = entity.toLowerCase().startsWith("&#x");
      const code = Number.parseInt(
        entity.slice(hex ? 3 : 2, -1),
        hex ? 16 : 10,
      );
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function categoryDescription(name: string, html: string) {
  const text = seoText(html);
  if (!text)
    return `${name} Royal Purple — oryginalne oleje z importu, ceny brutto, wysyłka z Kielc. INNOCHEM, dystrybutor od 2009 roku.`;
  const sentence = text.match(/^.*?[.!?](?:\s|$)/u)?.[0].trim() || text;
  return Array.from(sentence).slice(0, 155).join("");
}
