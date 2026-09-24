import Link from "next/link";
import { Reveal } from "./Reveal";
import type { SiteContent } from "@/lib/site-content";
import { mediaSrc, mediaSrcSet } from "@/lib/media";
export function HomeContent({ home }: { home: SiteContent["home"] }) {
  const { hero, benefits, categories, technology, featured } = home;
  return (
    <>
      {hero.enabled && (
        <section className="hero">
          <div
            className="hero-bg"
            style={
              hero.background.path
                ? {
                    backgroundImage: `url(${JSON.stringify(hero.background.path)})`,
                  }
                : undefined
            }
          />
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
                  width={1024}
                  height={1536}
                  fetchPriority="high"
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
      {technology.enabled && (
        <section className="split" id="technologia">
          <div className="split-grid">
            <div
              className="split-photo"
              role={technology.image.alt ? "img" : undefined}
              aria-label={technology.image.alt || undefined}
              style={
                technology.image.path
                  ? {
                      backgroundImage: `url(${JSON.stringify(technology.image.path)})`,
                    }
                  : undefined
              }
            />
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
                    width={1024}
                    height={1536}
                    loading="lazy"
                    decoding="async"
                  />
                )}
              </div>
              <div className="feature-copy">
                <span className="label">{featured.label}</span>
                <h2 className="display">{featured.title}</h2>
                <p>{featured.text}</p>
                <div className="cta-row">
                  <Link className="btn btn-primary" href={featured.link.href}>
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
