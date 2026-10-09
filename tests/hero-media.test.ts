import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canCropHero } from "../lib/server/hero-media";
import type { SiteContent } from "../lib/site-content";
const reference = JSON.parse(
  readFileSync(new URL("./fixtures/hero-layout.json", import.meta.url), "utf8"),
) as SiteContent["home"];
test("audited hero crops stop being selected when CMS content changes its layout", () => {
  assert(canCropHero(reference.hero, reference.benefits));
  assert.equal(
    canCropHero(
      { ...reference.hero, title: "A much shorter title" },
      reference.benefits,
    ),
    false,
  );
  assert.equal(
    canCropHero(
      {
        ...reference.hero,
        image: { path: "/media/square.png", alt: "New image" },
      },
      reference.benefits,
    ),
    false,
  );
  assert.equal(canCropHero(reference.hero, []), false);
});
test("link destinations and descriptive alt text retain the audited hero geometry", () => {
  assert(
    canCropHero(
      {
        ...reference.hero,
        image: { ...reference.hero.image, alt: "New descriptive alt text" },
        link: { ...reference.hero.link, href: "/katalog" },
      },
      reference.benefits,
    ),
  );
});

test("server hero markup keeps the full original for a CMS layout edit", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { HomeContent } = await import("../components/HomeContent");
  const { defaultSiteContent } = await import("../lib/site-content");
  const home = structuredClone(defaultSiteContent.home);
  home.hero = {
    ...home.hero,
    ...reference.hero,
    image: { ...home.hero.image, ...reference.hero.image },
    link: { ...home.hero.link, ...reference.hero.link },
    secondary: { ...home.hero.secondary, ...reference.hero.secondary },
    background: { path: "/hero-olej.webp", alt: "" },
  };
  home.benefits = reference.benefits;
  const markup = () =>
    renderToStaticMarkup(
      createElement(HomeContent, {
        home,
        series: "",
        seriesProducts: [],
      }),
    );
  assert.match(markup(), /hero-olej-small-d4f01e0e78905be3/);
  home.hero.title = "Short CMS title";
  const edited = markup();
  assert.doesNotMatch(edited, /hero-olej-(small|mobile)-/);
  assert.match(edited, /src="\/hero-olej.webp"/);
});
