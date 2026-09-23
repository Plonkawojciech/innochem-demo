import { z } from "zod";

const text = z.string().trim().max(2000);
const title = z.string().trim().min(1).max(180);
export const siteLink = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    if (/[\s\\\u0000-\u001f]/.test(value)) return false;
    if (/^#[a-z][a-z0-9-]*$/i.test(value)) return true;
    try {
      const decoded = decodeURIComponent(value);
      if (
        decoded.startsWith("//") ||
        decoded.includes("\\") ||
        /[\u0000-\u001f]/.test(decoded)
      )
        return false;
      if (value.startsWith("/") && !value.startsWith("//"))
        return (
          new URL(value, "https://innochem.invalid").origin ===
          "https://innochem.invalid"
        );
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Podaj adres sklepu zaczynający się od / albo pełny adres HTTPS.");
const link = z.object({ name: title, href: siteLink }).strict();
const image = z
  .object({
    path: z
      .string()
      .max(500)
      .refine(
        (v) =>
          v === "" ||
          (v.startsWith("/") &&
            !/[\\?#\s]/.test(v) &&
            !v.startsWith("//") &&
            !v.includes("..")),
        "Wybierz zdjęcie z biblioteki.",
      ),
    alt: z.string().trim().max(300),
  })
  .strict();
const feature = z
  .object({
    enabled: z.boolean(),
    label: text,
    title,
    text,
    image,
    productId: z.uuid().nullable(),
    link,
  })
  .strict();
const landing = z
  .object({
    label: text,
    title,
    bodyHtml: z.string().max(50000),
    metaDescription: z.string().max(320),
    subject: z.string().trim().min(1).max(180),
    image,
  })
  .strict();
export const siteContentSchema = z
  .object({
    brand: z
      .object({
        name: title,
        tagline: text,
        logo: image,
        footerText: text,
        copyright: text,
      })
      .strict(),
    contact: z
      .object({
        company: title,
        email: z.email(),
        phone: z.string().trim().min(3).max(50),
        address: text,
        hours: text,
        nip: z.string().max(30),
        regon: z.string().max(30),
      })
      .strict(),
    seo: z.object({ title, description: z.string().max(320), image }).strict(),
    navigation: z
      .object({
        main: z.array(link).min(1).max(10),
        categories: z
          .array(link.extend({ items: z.array(link).max(12) }))
          .max(12),
        highlighted: link,
      })
      .strict(),
    footer: z
      .array(z.object({ title, links: z.array(link).max(12) }).strict())
      .max(5),
    home: z
      .object({
        hero: feature.extend({ background: image, secondary: link }),
        benefits: z.array(z.object({ title, text }).strict()).max(8),
        categories: z
          .object({
            enabled: z.boolean(),
            label: text,
            title,
            items: z.array(link.extend({ description: text })).max(12),
          })
          .strict(),
        technology: z
          .object({
            enabled: z.boolean(),
            label: text,
            title,
            text,
            image,
            items: z.array(z.object({ title, text }).strict()).max(8),
          })
          .strict(),
        featured: feature,
      })
      .strict(),
    contactPage: landing,
    industryPage: landing.extend({
      departments: z
        .array(
          z
            .object({
              key: z
                .string()
                .regex(/^[a-z0-9-]+$/)
                .max(80),
              name: title,
            })
            .strict(),
        )
        .max(20),
    }),
    distributorsPage: landing,
  })
  .strict();
export type SiteContent = z.infer<typeof siteContentSchema>;
export type SiteImage = SiteContent["brand"]["logo"];
export const defaultSiteContent: SiteContent = {
  brand: {
    name: "INNOCHEM",
    tagline: "Royal Purple Polska",
    logo: { path: "", alt: "INNOCHEM" },
    footerText: "Oleje i smary Royal Purple.",
    copyright: "Wszystkie prawa zastrzeżone.",
  },
  contact: {
    company: "INNOCHEM Aneta Zalewska",
    email: "kontakt@innochem.pl",
    phone: "602 155 919",
    address: "ul. Okrzei 64\n25-526 Kielce",
    hours: "Poniedziałek–piątek, 8:00–16:00",
    nip: "9591542469",
    regon: "292849045",
  },
  seo: {
    title:
      "INNOCHEM — Oleje i smary Royal Purple | Wyłączny dystrybutor w Polsce",
    description:
      "Syntetyczne oleje silnikowe i przemysłowe Royal Purple. Oficjalna dystrybucja w Polsce — sklep internetowy INNOCHEM.",
    image: { path: "", alt: "" },
  },
  navigation: {
    main: [
      { name: "Produkty", href: "/katalog" },
      { name: "O firmie", href: "/o-firmie" },
      { name: "Kontakt", href: "/kontakt" },
      { name: "Moje konto", href: "/konto" },
    ],
    categories: [
      {
        name: "Oleje samochodowe",
        href: "/kategoria/oleje-samochodowe",
        items: [
          { name: "Oleje silnikowe", href: "/kategoria/oleje-silnikowe" },
          {
            name: "Oleje przekładniowe",
            href: "/kategoria/oleje-przekladniowe",
          },
          { name: "Inne", href: "/kategoria/inne" },
        ],
      },
      {
        name: "Oleje motocyklowe",
        href: "/kategoria/oleje-motocyklowe",
        items: [],
      },
      {
        name: "Oleje wyścigowe",
        href: "/kategoria/oleje-wyscigowe",
        items: [],
      },
      {
        name: "Oleje przemysłowe",
        href: "/przemysl",
        items: [
          {
            name: "Oleje i smary przekładniowe",
            href: "/przemysl?dzial=przekladnie",
          },
          { name: "Smary do kompresorów", href: "/przemysl?dzial=kompresory" },
          { name: "Oleje do sprężarek", href: "/przemysl?dzial=sprezarki" },
          { name: "Oleje hydrauliczne", href: "/przemysl?dzial=hydraulika" },
          { name: "Inne płyny i oleje", href: "/przemysl?dzial=inne" },
        ],
      },
    ],
    highlighted: { name: "Zostań dystrybutorem", href: "/dystrybutorzy" },
  },
  footer: [
    {
      title: "Sklep",
      links: [
        { name: "Wszystkie produkty", href: "/katalog" },
        { name: "Oleje przemysłowe", href: "/przemysl" },
        { name: "Moje konto", href: "/konto" },
      ],
    },
    {
      title: "Informacje",
      links: [
        { name: "Dostawa i płatności", href: "/dostawa-i-platnosci" },
        { name: "Zwroty i reklamacje", href: "/zwroty-i-reklamacje" },
        { name: "Regulamin", href: "/regulamin" },
        { name: "Polityka prywatności", href: "/polityka-prywatnosci" },
        { name: "Cookies", href: "/polityka-cookies" },
      ],
    },
    {
      title: "Współpraca",
      links: [
        { name: "Zostań dystrybutorem", href: "/dystrybutorzy" },
        { name: "Napisz do nas", href: "/kontakt" },
        { name: "O firmie", href: "/o-firmie" },
      ],
    },
  ],
  home: {
    hero: {
      enabled: true,
      label: "Wyłączny dystrybutor Royal Purple w Polsce · od 2009",
      title: "Syntetyczne oleje silnikowe Royal Purple",
      text: "Royal Purple powstało w 1986 roku wokół opatentowanych technologii smarowania Synfilm i Synerlec. INNOCHEM sprowadza oryginalne produkty marki do Polski i pomaga dobrać olej do konkretnego silnika.",
      image: { path: "/img/rp-hps-5w30-hd.png", alt: "Royal Purple HPS 5W-30" },
      productId: null,
      background: { path: "/hero-olej.png", alt: "" },
      link: {
        name: "Poznaj serię HPS",
        href: "/produkt/hps-5w30",
      },
      secondary: { name: "Katalog produktów", href: "#kategorie" },
    },
    benefits: [
      {
        title: "Import z USA",
        text: "oryginalne produkty z oficjalnej dystrybucji",
      },
      {
        title: "Wysyłka z Kielc",
        text: "produkty dostępne w naszym magazynie",
      },
      {
        title: "Dobór oleju",
        text: "pomoc w wyborze produktu do Twojego silnika",
      },
      { title: "Sieć dystrybucji", text: "współpraca B2B, faktura VAT" },
    ],
    categories: {
      enabled: true,
      label: "Katalog",
      title: "Kategorie produktów",
      items: [
        {
          name: "Oleje samochodowe",
          href: "/kategoria/oleje-samochodowe",
          description: "silnikowe i przekładniowe · lepkości 0W-20 do 20W-50",
        },
        {
          name: "Oleje motocyklowe",
          href: "/kategoria/oleje-motocyklowe",
          description: "silnik, sprzęgło i skrzynia biegów",
        },
        {
          name: "Oleje wyścigowe",
          href: "/kategoria/oleje-wyscigowe",
          description: "tor, rajdy i sporty motorowe",
        },
        {
          name: "Oleje przemysłowe",
          href: "/przemysl",
          description:
            "sprężarki, przekładnie, hydraulika i smary do kompresorów",
        },
      ],
    },
    technology: {
      enabled: true,
      label: "Technologia",
      title: "Synerlec — opatentowany pakiet dodatków",
      text: "Zaawansowane syntetyczne dodatki Synerlec tworzą mocny film olejowy na powierzchniach metalowych — zwiększają jego grubość i wytrzymałość, zapobiegając kontaktowi metal-metal i ograniczając zużycie części trących. To technologia, od której zaczęła się cała linia produktów Royal Purple.",
      image: { path: "/tlo-silnik.png", alt: "Silnik" },
      items: [
        {
          title: "FILM",
          text: "mocny syntetyczny film olejowy zapobiega kontaktowi metal-metal",
        },
        {
          title: "KOROZJA",
          text: "wypiera wilgoć i chroni powierzchnie metalowe przed korozją",
        },
        {
          title: "STABILNOŚĆ",
          text: "wysoka odporność na utlenianie wydłuża czas eksploatacji",
        },
      ],
    },
    featured: {
      enabled: true,
      label: "Seria HPS",
      title: "Royal Purple HPS 5W-30",
      text: "Syntetyczny olej serii High Performance Street do silników benzynowych i Diesla — z pakietem Synerlec i dodatkami cynku i fosforu, opracowany dla silników wysokiej wydajności i po modyfikacjach. Sprawdź zastosowanie, dostępność i opis produktu.",
      image: { path: "/img/rp-hps-5w30-hd.png", alt: "Royal Purple HPS 5W-30" },
      productId: null,
      link: {
        name: "Zobacz kartę produktu",
        href: "/produkt/hps-5w30",
      },
    },
  },
  contactPage: {
    label: "Porozmawiajmy o olejach",
    title: "Kontakt",
    bodyHtml: "<p>Pomożemy dobrać olej i sprawdzić dostępność produktu.</p>",
    metaDescription:
      "Kontakt z INNOCHEM. Dobór oleju Royal Purple i dostępność produktów.",
    subject: "Zapytanie",
    image: { path: "", alt: "" },
  },
  industryPage: {
    label: "Royal Purple dla przemysłu",
    title: "Dobór do Twojego zastosowania",
    bodyHtml:
      "<p>Oleje przemysłowe zamawiasz po indywidualnym uzgodnieniu. Opisz urządzenie, warunki pracy, wymaganą specyfikację oraz potrzebną ilość.</p><p>Sprawdzimy dobór, dostępność i warunki zamówienia.</p>",
    metaDescription:
      "Dobór olejów i smarów Royal Purple do zastosowań przemysłowych.",
    subject: "Oleje przemysłowe",
    image: { path: "", alt: "" },
    departments: [
      { key: "przekladnie", name: "Oleje i smary przekładniowe" },
      { key: "kompresory", name: "Smary do kompresorów" },
      { key: "sprezarki", name: "Oleje do sprężarek" },
      { key: "hydraulika", name: "Oleje hydrauliczne" },
      { key: "inne", name: "Inne płyny i oleje" },
    ],
  },
  distributorsPage: {
    label: "Współpraca B2B",
    title: "Royal Purple w Twojej ofercie",
    bodyHtml:
      "<p>Prowadzisz sklep motoryzacyjny lub warsztat? Napisz, gdzie działasz i jakie produkty Cię interesują. Porozmawiamy o dostępności oraz warunkach współpracy.</p>",
    metaDescription: "Współpraca z INNOCHEM w dystrybucji olejów Royal Purple.",
    subject: "Współpraca dystrybucyjna",
    image: { path: "", alt: "" },
  },
};
export function phoneHref(phone: string) {
  return `tel:${phone.replace(/[^+0-9]/g, "")}`;
}
