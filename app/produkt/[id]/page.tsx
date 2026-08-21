import Link from "next/link";
import { notFound } from "next/navigation";
import { PRODUCTS } from "@/lib/products";
import { Footer } from "@/components/SiteChrome";
import { BuyBox } from "./BuyBox";

export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = PRODUCTS.find((x) => x.id === id);
  return { title: p ? `${p.name} ${p.visc} (${p.vol}) — INNOCHEM` : "INNOCHEM" };
}

export default async function ProduktPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) notFound();

  return (
    <>
      <div className="wrap">
        <p className="crumbs">
          <Link href="/">Sklep</Link> / <Link href="/#kategorie">Oleje samochodowe</Link>{" "}
          / <span>{p.name} {p.visc}</span>
        </p>

        <main className="pdp">
          <div className="pdp-photo">
            <img src={p.img} alt={`${p.name} ${p.visc}`} />
          </div>

          <div>
            <div className="visc-big">{p.visc}</div>
            <h1 className="display">{p.name}</h1>
            <div className="tag-row">
              <span className="tag">{p.tag}</span>
              <span className="tag">SYNERLEC</span>
              <span className="tag">{p.vol}</span>
            </div>
            <p className="desc">
              Syntetyczny olej silnikowy do silników benzynowych i Diesla, opracowany dla jednostek wysokiej
              wydajności i po modyfikacjach. Zawiera opatentowany pakiet dodatków Synerlec oraz związki cynku
              i fosforu (dodatki przeciwzużyciowe). Ze względu na zwiększoną zawartość dodatków AW olej nie
              posiada klasyfikacji API — zalecany do pojazdów nieobjętych już gwarancją producenta.
            </p>

            <BuyBox product={p} />

            <table className="spec">
              <tbody>
                <tr>
                  <th colSpan={2}>Specyfikacja techniczna</th>
                </tr>
                <tr>
                  <td>Klasa lepkości SAE</td>
                  <td>{p.visc}</td>
                </tr>
                <tr>
                  <td>Baza olejowa</td>
                  <td>pełna synteza</td>
                </tr>
                <tr>
                  <td>Dodatek uszlachetniający</td>
                  <td>Synerlec</td>
                </tr>
                <tr>
                  <td>Zawartość ZDDP (cynk/fosfor)</td>
                  <td>podwyższona</td>
                </tr>
                <tr>
                  <td>Pojemność opakowania</td>
                  <td>0,946 l (1 US qt)</td>
                </tr>
                <tr>
                  <td>Zastosowanie</td>
                  <td>benzyna / diesel</td>
                </tr>
                <tr>
                  <td>Klasyfikacja API</td>
                  <td>brak — zwiększone dodatki AW</td>
                </tr>
              </tbody>
            </table>

            <h2 className="display">Dla kogo ten olej</h2>
            <p className="desc">
              Seria HPS (High Performance Street) powstała dla kierowców poszukujących wyższej jakości,
              wydajności i ochrony: aut o podwyższonych osiągach, silników po modyfikacjach i pojazdów
              eksploatowanych intensywnie. Jeśli nie masz pewności, czy to właściwa lepkość dla Twojego
              silnika — napisz do nas, pomożemy dobrać olej do konkretnej jednostki.
            </p>
          </div>
        </main>
      </div>

      <Footer />
    </>
  );
}
