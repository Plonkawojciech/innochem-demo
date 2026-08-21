import Link from "next/link";
import { ProductGrid } from "@/components/ProductCard";
import { Reveal } from "@/components/Reveal";
import { Footer } from "@/components/SiteChrome";

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-bg" style={{ backgroundImage: "url(/hero-olej.png)" }} />
        <div className="wrap hero-grid">
          <div>
            <p className="kicker">Oficjalna dystrybucja Royal Purple · Polska</p>
            <h1 className="display">
              Syntetyczne oleje klasy <span className="v">wyścigowej</span>
            </h1>
            <p className="lead">
              Royal Purple od ponad 30 lat powstaje w Teksasie dla silników, od których wymaga się
              najwięcej. Technologia Synerlec, pełna specyfikacja API i doradztwo techniczne — bezpośrednio
              od wyłącznego dystrybutora w Polsce.
            </p>
            <div className="cta-row">
              <Link className="btn btn-primary" href="/produkt/hps-5w30">
                Poznaj serię HPS
              </Link>
              <a className="btn btn-ghost" href="#kategorie">
                Katalog produktów
              </a>
            </div>
          </div>
          <div className="hero-photo">
            <img src="/img/rp-hps-5w30-hd.png" alt="Royal Purple HPS 5W-30" width={1024} height={1536} />
          </div>
        </div>
        <div className="hero-meta">
          <div className="wrap">
            <div className="hm"><b>Import z USA</b><span>oryginalne produkty z dystrybucji</span></div>
            <div className="hm"><b>Wysyłka w 24 h</b><span>kurier i paczkomaty w całej Polsce</span></div>
            <div className="hm"><b>Dobór oleju</b><span>doradztwo techniczne do konkretnej jednostki</span></div>
            <div className="hm"><b>Obsługa B2B</b><span>faktura VAT, cenniki dla warsztatów</span></div>
          </div>
        </div>
      </section>

      <section className="block" id="kategorie">
        <div className="wrap">
          <Reveal className="sec-head">
            <div>
              <span className="label">Katalog</span>
              <h2 className="display">Kategorie produktów</h2>
            </div>
          </Reveal>
          <Reveal className="cats">
            <Link className="cat" href="/produkt/hps-5w30">
              <span className="idx">01</span>
              <b>Oleje samochodowe<small>lepkości 0W-20 do 20W-50 · serie API, HPS i XPR</small></b>
              <span className="go">→</span>
            </Link>
            <Link className="cat" href="/produkt/hps-5w30">
              <span className="idx">02</span>
              <b>Oleje motocyklowe<small>seria Max-Cycle · silnik, sprzęgło i skrzynia</small></b>
              <span className="go">→</span>
            </Link>
            <Link className="cat" href="/produkt/0w40">
              <span className="idx">03</span>
              <b>Oleje wyścigowe<small>XPR Racing · tor, rajdy i sporty motorowe</small></b>
              <span className="go">→</span>
            </Link>
            <Link className="cat" href="/produkt/5w30">
              <span className="idx">04</span>
              <b>Przemysł i hydraulika<small>sprężarki, przekładnie, układy hydrauliczne</small></b>
              <span className="go">→</span>
            </Link>
          </Reveal>
        </div>
      </section>

      <div className="split" id="technologia">
        <div className="split-grid">
          <div className="split-photo" style={{ backgroundImage: "url(/tlo-silnik.png)" }} />
          <div className="split-copy">
            <span className="label">Technologia</span>
            <h2 className="display">Synerlec — film olejowy, który nie ustępuje</h2>
            <p>
              Opatentowany pakiet uszlachetniający Royal Purple wiąże się z powierzchnią metalu, tworząc
              warstwę ochronną o wytrzymałości niedostępnej dla klasycznej syntezy. Silnik pracuje ciszej,
              chłodniej i zużywa się wolniej — niezależnie od tego, czy to codzienny diesel, czy jednostka
              po tuningu.
            </p>
            <div className="split-list">
              <div className="sl"><span className="k">FILM</span><span className="t">wyższa wytrzymałość warstwy olejowej pod obciążeniem</span></div>
              <div className="sl"><span className="k">ZDDP</span><span className="t">podwyższony cynk i fosfor — ochrona rozrządu</span></div>
              <div className="sl"><span className="k">TEMP</span><span className="t">niższa temperatura pracy przy wysokich obrotach</span></div>
            </div>
          </div>
        </div>
      </div>

      <section className="block" id="bestsellery">
        <div className="wrap">
          <Reveal className="sec-head">
            <div>
              <span className="label">Najczęściej wybierane</span>
              <h2 className="display">Bestsellery</h2>
            </div>
            <Link href="/produkt/hps-5w30">Zobacz pełną ofertę</Link>
          </Reveal>
          <ProductGrid />
        </div>
      </section>

      <Footer full />
    </>
  );
}
