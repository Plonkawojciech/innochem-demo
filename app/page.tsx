import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { Footer } from "@/components/SiteChrome";

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-bg" style={{ backgroundImage: "url(/hero-olej.png)" }} />
        <div className="wrap hero-grid">
          <div>
            <p className="kicker">Wyłączny dystrybutor Royal Purple w Polsce · od 2009</p>
            <h1 className="display">
              Syntetyczne oleje silnikowe <span className="v">z Teksasu</span>
            </h1>
            <p className="lead">
              Royal Purple powstało w 1986 roku wokół opatentowanych technologii smarowania Synfilm
              i Synerlec. INNOCHEM sprowadza oryginalne produkty marki do Polski i pomaga dobrać
              olej do konkretnego silnika.
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
            <div className="hm"><b>Import z USA</b><span>oryginalne produkty z oficjalnej dystrybucji</span></div>
            <div className="hm"><b>Wysyłka z Kielc</b><span>kurier i paczkomaty w całej Polsce</span></div>
            <div className="hm"><b>Dobór oleju</b><span>doradztwo i baza wiedzy o smarowaniu</span></div>
            <div className="hm"><b>Sieć dystrybucji</b><span>współpraca B2B, faktura VAT</span></div>
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
              <b>Oleje samochodowe<small>silnikowe i przekładniowe · lepkości 0W-20 do 20W-50</small></b>
              <span className="go">→</span>
            </Link>
            <Link className="cat" href="/produkt/hps-5w30">
              <span className="idx">02</span>
              <b>Oleje motocyklowe<small>silnik, sprzęgło i skrzynia biegów</small></b>
              <span className="go">→</span>
            </Link>
            <Link className="cat" href="/produkt/hps-5w30">
              <span className="idx">03</span>
              <b>Oleje wyścigowe<small>tor, rajdy i sporty motorowe</small></b>
              <span className="go">→</span>
            </Link>
            <Link className="cat" href="/produkt/hps-5w30">
              <span className="idx">04</span>
              <b>Oleje przemysłowe<small>sprężarki, przekładnie, hydraulika i smary do kompresorów</small></b>
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
            <h2 className="display">Synerlec — opatentowany pakiet dodatków</h2>
            <p>
              Zaawansowane syntetyczne dodatki Synerlec tworzą mocny film olejowy na powierzchniach
              metalowych — zwiększają jego grubość i wytrzymałość, zapobiegając kontaktowi metal-metal
              i ograniczając zużycie części trących. To technologia, od której zaczęła się cała linia
              produktów Royal Purple.
            </p>
            <div className="split-list">
              <div className="sl"><span className="k">FILM</span><span className="t">mocny syntetyczny film olejowy zapobiega kontaktowi metal-metal</span></div>
              <div className="sl"><span className="k">KOROZJA</span><span className="t">wypiera wilgoć i chroni powierzchnie metalowe przed korozją</span></div>
              <div className="sl"><span className="k">STABILNOŚĆ</span><span className="t">wysoka odporność na utlenianie wydłuża czas eksploatacji</span></div>
            </div>
          </div>
        </div>
      </div>

      <section className="block" id="produkt">
        <div className="wrap">
          <Reveal className="feature">
            <div className="feature-photo">
              <img src="/img/rp-hps-5w30-hd.png" alt="Royal Purple HPS 5W-30" width={1024} height={1536} />
            </div>
            <div className="feature-copy">
              <span className="label">Przykładowa karta produktu</span>
              <h2 className="display">Royal Purple HPS 5W-30</h2>
              <p>
                Syntetyczny olej serii High Performance Street do silników benzynowych i Diesla —
                z pakietem Synerlec i dodatkami cynku i fosforu, opracowany dla silników wysokiej
                wydajności i po modyfikacjach. Zobacz, jak w nowym sklepie wygląda pełna karta
                produktu ze specyfikacją i zamówieniem.
              </p>
              <div className="cta-row">
                <Link className="btn btn-primary" href="/produkt/hps-5w30">Zobacz kartę produktu</Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <Footer full />
    </>
  );
}
