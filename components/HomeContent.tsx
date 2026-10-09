import Link from "next/link";
import { Reveal } from "./Reveal";
import type { SiteContent } from "@/lib/site-content";
import { mediaSrc, mediaSrcSet } from "@/lib/media";
import { productFacts } from "@/lib/product-facts";
import type { StoreProduct } from "@/lib/store-types";
import { canCropHero } from "@/lib/server/hero-media";
export function HomeContent({
  home,
  series,
  seriesProducts,
}: {
  home: SiteContent["home"];
  series: string;
  seriesProducts: StoreProduct[];
}) {
  const { hero, benefits, categories, technology, featured } = home;
  const mobileHero = "/hero-olej-mobile-855b096a504ba167.avif";
  const smallHero = "/hero-olej-small-d4f01e0e78905be3.avif";
  const defaultHero =
    hero.background.path === "/hero-olej.webp" && canCropHero(hero, benefits);
  return (
    <>
      {hero.enabled && (
        <section className="hero">
          <div className="hero-bg">
            {defaultHero ? (
              <>
                <link
                  rel="preload"
                  as="image"
                  href={smallHero}
                  type="image/avif"
                  media="(width <= 500px)"
                  fetchPriority="high"
                />
                <link
                  rel="preload"
                  as="image"
                  href={mobileHero}
                  type="image/avif"
                  media="(500px < width <= 800px)"
                  fetchPriority="high"
                />
                <link
                  rel="preload"
                  as="image"
                  href={hero.background.path}
                  media="(width > 800px)"
                  fetchPriority="high"
                />
                <picture>
                  <source
                    srcSet={smallHero}
                    type="image/avif"
                    media="(width <= 500px)"
                  />
                  <source
                    srcSet={mobileHero}
                    type="image/avif"
                    media="(500px < width <= 800px)"
                  />
                  <img
                    src={hero.background.path}
                    alt=""
                    fetchPriority="high"
                    decoding="sync"
                  />
                </picture>
              </>
            ) : hero.background.path ? (
              <img
                src={hero.background.path}
                alt=""
                fetchPriority="high"
                decoding="sync"
              />
            ) : null}
          </div>
          <div className="wrap hero-grid">
            <div>
              <p className="kicker">{hero.label}</p>
              <h1 className="display">{hero.title}</h1>
              <p className="lead">{hero.text}</p>
              <div className="cta-row">
                <Link className="btn btn-primary" href={hero.link.href}>
                  {hero.link.name}
                </Link>
                <Link className="btn btn-ghost" href={hero.secondary.href}>
                  {hero.secondary.name}
                </Link>
              </div>
            </div>
            <div className="hero-photo">
              {hero.image.path && (
                <img
                  src={mediaSrc(hero.image.path, 960)}
                  srcSet={mediaSrcSet(hero.image.path, [480, 640, 960])}
                  sizes="(max-width: 900px) 70vw, 460px"
                  alt={hero.image.alt}
                  width={1000}
                  height={1400}
                  fetchPriority="low"
                  decoding="async"
                />
              )}
            </div>
          </div>
          {!!benefits.length && (
            <div className="hero-meta">
              <div className="wrap">
                {benefits.map((b, i) => (
                  <div className="hm" key={i}>
                    <b>{b.title}</b>
                    <span>{b.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
      {categories.enabled && (
        <section className="block" id="kategorie">
          <div className="wrap">
            <Reveal className="sec-head">
              <div>
                <span className="label">{categories.label}</span>
                <h2 className="display">{categories.title}</h2>
              </div>
            </Reveal>
            <Reveal className="cats">
              {categories.items.map((c, i) => (
                <Link className="cat" href={c.href} key={i}>
                  <span className="idx">{String(i + 1).padStart(2, "0")}</span>
                  <b>
                    {c.name}
                    <small>{c.description}</small>
                  </b>
                  <span className="go">→</span>
                </Link>
              ))}
            </Reveal>
          </div>
        </section>
      )}
      <div className="wrap">
        <aside className="oil-advice">
          <p>
            Nie wiesz, który olej wybrać? Napisz, jaki masz silnik, a dobierzemy
            olej i sprawdzimy dostępność.
          </p>
          <Link className="btn btn-outline" href="/kontakt?temat=dobor">
            Zapytaj o dobór
          </Link>
        </aside>
      </div>
      {technology.enabled && (
        <section className="split" id="technologia">
          <div className="split-grid">
            <div className="split-photo">
              {technology.image.path && (
                <picture>
                  {technology.image.path === "/tlo-silnik.webp" && (
                    <source
                      type="image/avif"
                      srcSet="/tlo-silnik-480-4e7a56fa45622363.avif 480w, /tlo-silnik-800-1753ea917a467a6e.avif 800w, /tlo-silnik-1024-f70777c1c04c694b.avif 1024w"
                      sizes="(max-width: 900px) 100vw, 50vw"
                    />
                  )}
                  <img
                    src={technology.image.path}
                    alt={technology.image.alt}
                    loading="lazy"
                    fetchPriority="low"
                    decoding="async"
                  />
                </picture>
              )}
            </div>
            <div className="split-copy">
              <span className="label">{technology.label}</span>
              <h2 className="display">{technology.title}</h2>
              <p>{technology.text}</p>
              <div className="split-list">
                {technology.items.map((b, i) => (
                  <div className="sl" key={i}>
                    <span className="k">{b.title}</span>
                    <span className="t">{b.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}
      {featured.enabled && (
        <section className="block" id="produkt">
          <div className="wrap">
            <Reveal className="feature">
              <div className="feature-photo">
                {featured.image.path && (
                  <img
                    src={mediaSrc(featured.image.path, 640)}
                    srcSet={mediaSrcSet(
                      featured.image.path,
                      [320, 480, 640, 960],
                    )}
                    sizes="(max-width: 900px) 60vw, 320px"
                    alt={featured.image.alt}
                    width={1000}
                    height={1400}
                    loading="lazy"
                    fetchPriority="low"
                    decoding="async"
                  />
                )}
              </div>
              <div className="feature-copy">
                <span className="label">{featured.label}</span>
                <h2 className="display">{featured.title}</h2>
                <p>{featured.text}</p>
                {seriesProducts.length > 0 && (
                  <div className="series-list">
                    <span className="series-list-name">Produkty w serii</span>
                    <div className="series-chips">
                      {seriesProducts.map((p) => {
                        const facts = productFacts(p.name);
                        return (
                          <Link
                            key={p.id}
                            href={`/produkt/${p.slug}`}
                            className="series-chip"
                          >
                            <b>{facts.grade || facts.title}</b>
                            {facts.volume && <small>{facts.volume}</small>}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="cta-row">
                  <Link
                    className="btn btn-primary"
                    href={
                      seriesProducts.length > 1
                        ? `/katalog?q=${encodeURIComponent(series)}`
                        : featured.link.href
                    }
                  >
                    {seriesProducts.length > 1
                      ? `Zobacz całą serię ${series}`
                      : featured.link.name}
                  </Link>
                  <Link className="btn btn-ghost" href={featured.link.href}>
                    {featured.link.name}
                  </Link>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      )}
    </>
  );
}
