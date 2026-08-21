import Link from "next/link";
import { ProductGrid } from "@/components/ProductCard";
import { Reveal } from "@/components/Reveal";
import { Footer } from "@/components/SiteChrome";

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <p className="kicker">Wyłączny dystrybutor Royal Purple w Polsce</p>
            <h1 className="display">
              Olej, który
              <br />
              wygrywa <span className="v">wyścigi</span>
            </h1>
            <p className="lead">
              W pełni syntetyczne oleje Royal Purple z technologią Synerlec — do aut osobowych, motocykli,
              maszyn przemysłowych i torów wyścigowych. Prosto od oficjalnego dystrybutora, z dostawą w 24 h.
            </p>
            <div className="cta-row">
              <Link className="btn btn-primary" href="/produkt/hps-5w30">
                Zobacz bestseller HPS 5W-30
              </Link>
              <a className="btn btn-ghost" href="#kategorie">
                Wszystkie kategorie
              </a>
            </div>
          </div>
          <div className="hero-photo">
            <img src="/img/rp-motor-oil-hps-5w30.jpg" alt="Royal Purple HPS 5W-30" width={600} height={600} />
          </div>
        </div>
        <div className="checker" aria-hidden="true" />
      </section>

      <div className="trust">
        <div className="wrap trust-inner">
          <div className="trust-item">
            <b>Oryginalne produkty</b>
            <span>import bezpośrednio z USA</span>
          </div>
          <div className="trust-item">
            <b>Wysyłka w 24 h</b>
            <span>kurier i paczkomaty</span>
          </div>
          <div className="trust-item">
            <b>Doradztwo techniczne</b>
            <span>dobór oleju do silnika</span>
          </div>
          <div className="trust-item">
            <b>Faktura VAT</b>
            <span>obsługa firm i warsztatów</span>
          </div>
        </div>
      </div>

      <section className="block" id="kategorie">
        <div className="wrap">
          <Reveal className="sec-head">
            <h2 className="display">Kategorie</h2>
          </Reveal>
          <Reveal className="cats">
            <Link className="cat" href="/produkt/hps-5w30">
              <span className="mono">01 · MOTORYZACJA</span>
              <b>Oleje samochodowe</b>
              <span>0W-20 do 20W-50, HPS, XPR</span>
            </Link>
            <Link className="cat" href="/produkt/hps-5w30">
              <span className="mono">02 · MOTORYZACJA</span>
              <b>Oleje motocyklowe</b>
              <span>Max-Cycle, przekładnie</span>
            </Link>
            <Link className="cat" href="/produkt/0w40">
              <span className="mono">03 · SPORT</span>
              <b>Oleje wyścigowe</b>
              <span>XPR Racing, tor i rajdy</span>
            </Link>
            <Link className="cat" href="/produkt/5w30">
              <span className="mono">04 · PRZEMYSŁ</span>
              <b>Oleje przemysłowe</b>
              <span>hydrauliczne, sprężarki, przekładnie</span>
            </Link>
          </Reveal>
        </div>
      </section>

      <section className="block" id="bestsellery" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <Reveal className="sec-head">
            <h2 className="display">Bestsellery</h2>
            <Link href="/produkt/hps-5w30">Pełna oferta →</Link>
          </Reveal>
          <ProductGrid />
        </div>
      </section>

      <div className="band" id="dystrybucja">
        <div className="wrap band-grid">
          <Reveal>
            <div className="num">01</div>
            <h3>Technologia Synerlec</h3>
            <p>
              Opatentowany dodatek uszlachetniający buduje film olejowy o wytrzymałości nieosiągalnej dla
              zwykłej syntezy — mniejsze zużycie silnika i niższa temperatura pracy.
            </p>
          </Reveal>
          <Reveal>
            <div className="num">02</div>
            <h3>Od toru do warsztatu</h3>
            <p>
              Te same formuły, które pracują w NASCAR i NHRA, dostępne dla aut drogowych. Pełna specyfikacja
              API i dopuszczenia producentów.
            </p>
          </Reveal>
          <Reveal>
            <div className="num">03</div>
            <h3>Program dystrybucji</h3>
            <p>
              Warsztaty i sklepy motoryzacyjne zapraszamy do współpracy hurtowej — indywidualne cenniki,
              materiały ekspozycyjne, szkolenia produktowe.
            </p>
          </Reveal>
        </div>
      </div>

      <Footer full />
    </>
  );
}
