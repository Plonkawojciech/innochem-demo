import { database, transaction } from "../lib/server/db";
import { cleanHtml } from "../lib/server/content";
// Drafts intentionally contain blocking markers. Running this script is never legal approval.
const pages = [
  {
    slug: "o-firmie",
    title: "O firmie INNOCHEM",
    published: true,
    body: `
 <p>INNOCHEM działa od 2009 roku. Zajmujemy się dystrybucją olejów i smarów Royal Purple oraz pomocą w doborze produktów do samochodów, motocykli, sportu i przemysłu.</p>
 <h2>Dobór do konkretnego zastosowania</h2><p>Przy wyborze oleju liczą się wymagania producenta urządzenia, rodzaj silnika i warunki pracy. Jeśli potrzebujesz pomocy, prześlij model, rocznik, oznaczenie silnika i wymagane normy. W przypadku maszyn przemysłowych przyda się również dokumentacja urządzenia.</p>
 <p><a href="/katalog">Zobacz produkty</a> lub <a href="/kontakt">skontaktuj się z nami</a>. Zapraszamy także firmy zainteresowane <a href="/dystrybutorzy">współpracą dystrybucyjną</a>.</p>
 <h2>Dane firmy</h2><p>INNOCHEM Aneta Zalewska<br>ul. Okrzei 64, 25-526 Kielce<br>NIP: 9591542469 · REGON: 292849045</p><p>E-mail: <a href="mailto:kontakt@innochem.pl">kontakt@innochem.pl</a><br>Telefon: <a href="tel:+48602155919">602 155 919</a></p>`,
  },
  {
    slug: "regulamin",
    title: "Regulamin sklepu",
    published: false,
    body: `
 <p><strong>DO ZATWIERDZENIA — projekt dokumentu przed uruchomieniem sprzedaży.</strong></p>
 <h2>1. Sprzedawca i kontakt</h2><p>Sklep prowadzi INNOCHEM Aneta Zalewska, ul. Okrzei 64, 25-526 Kielce, NIP 9591542469, REGON 292849045. Kontakt w sprawie zamówień: sklep@innochem.pl, tel. 602 155 919. Korespondencję można kierować również na wskazany adres firmy.</p>
 <h2>2. Produkty i składanie zamówień</h2><p>Informacje o produkcie, pojemności, zastosowaniu, cenie brutto i dostępności znajdują się na jego stronie. Ostateczne podsumowanie zawiera ceny produktów oraz koszt wybranej dostawy. Walutą rozliczeń sklepu jest złoty polski. Zamówienie można złożyć bez konta lub po zalogowaniu. Przed zatwierdzeniem można zmienić zawartość koszyka i poprawić dane.</p><p>Przycisk „Zamawiam i płacę” oznacza złożenie zamówienia z obowiązkiem zapłaty. Produkty przemysłowe oznaczone jako dostępne na zapytanie wymagają indywidualnych ustaleń i nie są kupowane przez koszyk.</p>
 <p><strong>DO UZUPEŁNIENIA: moment zawarcia umowy i treść potwierdzenia przyjęcia zamówienia; termin płatności; termin realizacji; zasady anulowania rezerwacji. Obecne techniczne terminy rezerwacji nie stanowią zatwierdzonych warunków handlowych.</strong></p>
 <h2>3. Płatności i dostawa</h2><p>Przed zakupem klient wybiera spośród metod udostępnionych w koszyku. Szczegóły określa strona <a href="/dostawa-i-platnosci">Dostawa i płatności</a>.</p><p><strong>DO UZUPEŁNIENIA: zatwierdzony cennik, operator płatności, przewoźnik, obszar dostaw, czas wysyłki i numer rachunku.</strong></p>
 <h2>4. Odstąpienie i reklamacje</h2><p>Przy zakupie na odległość konsument ma co do zasady 14 dni od odbioru towaru na złożenie oświadczenia o odstąpieniu. Ustawowe uprawnienia obejmują też wskazane w ustawie zakupy osoby fizycznej prowadzącej działalność gospodarczą, niemające dla niej charakteru zawodowego. Szczegóły, sposób zgłoszenia i wzór oświadczenia znajdują się na stronie <a href="/zwroty-i-reklamacje">Zwroty i reklamacje</a>.</p>
 <h2>5. Konto i wymagania techniczne</h2><p>Do korzystania ze sklepu potrzebna jest przeglądarka z obsługą JavaScript i połączenie internetowe; do obsługi zamówienia i konta — adres e-mail. Konto pozwala sprawdzać zamówienia i zapisywać adresy. Stare hasła nie są przenoszone. Pierwsze logowanie do przeniesionego konta wymaga ustawienia nowego hasła przez link przesłany na jego adres e-mail. Reklamacje dotyczące działania sklepu można przekazać na kontakt@innochem.pl.</p>
 <p><strong>DO UZUPEŁNIENIA: zasady zakończenia usługi konta, pozasądowego rozwiązywania sporów oraz warunki dotyczące klientów biznesowych; zatwierdzenie pełnego dokumentu.</strong></p>`,
  },
  {
    slug: "zwroty-i-reklamacje",
    title: "Zwroty i reklamacje",
    published: false,
    body: `
 <p><strong>DO ZATWIERDZENIA — projekt informacji dla klientów.</strong></p>
 <h2>Odstąpienie od zakupu</h2><p>Konsument kupujący przez internet może co do zasady odstąpić od umowy bez podania przyczyny w ciągu 14 dni od otrzymania towaru. Oświadczenie można wysłać e-mailem na sklep@innochem.pl lub na adres firmy. Wystarczy jednoznacznie wskazać umowę, której dotyczy odstąpienie; poniższy wzór jest dobrowolny.</p><p>Towar należy odesłać w ciągu 14 dni od zgłoszenia odstąpienia. Zwrot płatności obejmuje koszt najtańszej zwykłej dostawy oferowanej przy zakupie. Sprzedawca może wstrzymać zwrot do otrzymania towaru lub dowodu odesłania. Za zmniejszenie wartości wynikające z używania wykraczającego poza konieczne sprawdzenie towaru odpowiada kupujący.</p>
 <p><strong>DO UZUPEŁNIENIA: potwierdzony adres zwrotów, informacja o bezpośrednich kosztach odesłania, pełne pouczenie i termin zwrotu płatności oraz sprawdzenie wyjątków mających zastosowanie do konkretnych produktów.</strong></p>
 <h2>Wzór oświadczenia</h2><blockquote><p>Do: INNOCHEM Aneta Zalewska, sklep@innochem.pl<br>Oświadczam, że odstępuję od umowy sprzedaży następujących produktów: …<br>Numer zamówienia lub dane pozwalające je rozpoznać: …<br>Data zakupu i odbioru: …<br>Imię, nazwisko i adres: …<br>Data: …<br>Podpis (tylko przy składaniu na papierze): …</p></blockquote>
 <h2>Reklamacja towaru</h2><p>Gdy towar jest niezgodny z umową, zgłoś reklamację sprzedawcy. Opisz problem, podaj dane zakupu i oczekiwany sposób rozwiązania. Paragon nie jest jedynym dopuszczalnym dowodem zakupu. Podstawowe uprawnienia obejmują naprawę lub wymianę, a w sytuacjach przewidzianych prawem — obniżenie ceny lub odstąpienie od umowy. Sprzedawca ponosi koszty uzasadnionej reklamacji. Odpowiedzialność co do zasady obejmuje niezgodności ujawnione w ciągu dwóch lat od dostawy. Odpowiedź na reklamację konsumenta powinna nastąpić w ciągu 14 dni.</p>
 <p>Kontakt: sklep@innochem.pl, tel. 602 155 919.</p><p><strong>DO UZUPEŁNIENIA: adres przekazania reklamowanego towaru i organizacja jego odbioru.</strong></p>`,
  },
  {
    slug: "dostawa-i-platnosci",
    title: "Dostawa i płatności",
    published: false,
    body: `
 <p><strong>DO ZATWIERDZENIA — sposoby dostawy i płatności oczekują na potwierdzenie.</strong></p><p>Dokładny koszt dostawy będzie widoczny w podsumowaniu przed zatwierdzeniem zamówienia. Obecnie sprzedaż w podglądzie sklepu jest wyłączona.</p><h2>Dostawa</h2><p><strong>DO UZUPEŁNIENIA: nazwa przewoźnika, ceny dostawy i pobrania, limit masy, obszar doręczeń, terminy przygotowania zamówienia i transportu, ewentualny odbiór osobisty.</strong></p><h2>Płatności</h2><p><strong>DO UZUPEŁNIENIA: zaakceptowane metody, aktywny operator płatności online, rachunek do przelewu i terminy płatności.</strong></p><p>W sprawach związanych z zamówieniem: <a href="mailto:sklep@innochem.pl">sklep@innochem.pl</a> lub <a href="tel:+48602155919">602 155 919</a>.</p>`,
  },
  {
    slug: "polityka-prywatnosci",
    title: "Polityka prywatności",
    published: false,
    body: `
 <p><strong>DO ZATWIERDZENIA — projekt wymaga uzupełnienia faktycznych dostawców usług i okresów przechowywania.</strong></p><h2>Administrator danych</h2><p>Administratorem jest INNOCHEM Aneta Zalewska, ul. Okrzei 64, 25-526 Kielce. W sprawach danych osobowych: kontakt@innochem.pl.</p><h2>Jakie dane zapisuje sklep</h2><p>Przy zakupie są to dane kontaktowe, dane nabywcy, adres dostawy i informacje o zamówieniu. Konto przechowuje adres e-mail, imię i nazwisko, zapisane adresy oraz powiązanie z zamówieniami. Formularz kontaktowy zapisuje treść zapytania i podane dane kontaktowe. System rejestruje operacje administracyjne i informacje potrzebne do ochrony przed nadużyciami.</p><h2>Cele, podstawy i czas przechowywania</h2><p><strong>DO UZUPEŁNIENIA: podstawy przetwarzania dla realizacji zamówień, usług konta, zapytań, obowiązków księgowych i roszczeń; okresy przechowywania i kryteria ich ustalania.</strong></p><h2>Odbiorcy danych</h2><p><strong>DO UZUPEŁNIENIA: rzeczywisty hosting, obsługa techniczna, poczta, księgowość, przewoźnicy i operator płatności; role tych podmiotów oraz ewentualne transfery poza EOG.</strong></p><h2>Twoje prawa</h2><p>W granicach określonych w RODO możesz żądać dostępu do danych, sprostowania, usunięcia, ograniczenia przetwarzania i przeniesienia danych. W odpowiednich przypadkach przysługuje sprzeciw oraz wycofanie zgody. Możesz też złożyć skargę do Prezesa UODO. Żądanie można przesłać na kontakt@innochem.pl.</p><h2>Technologie przeglądarki</h2><p>Szczegóły opisuje <a href="/polityka-cookies">polityka cookies</a>. W przygotowanej wersji nie uruchomiono narzędzi analitycznych ani reklamowych. Sam zakup lub zapytanie nie zapisuje klienta do newslettera.</p><p><strong>DO UZUPEŁNIENIA: obowiązkowość podania poszczególnych danych i skutki odmowy, ocena profilowania i zatwierdzenie informacji o wszystkich procesach administratora.</strong></p>`,
  },
  {
    slug: "polityka-cookies",
    title: "Cookies i pamięć przeglądarki",
    published: false,
    body: `
 <p><strong>DO ZATWIERDZENIA — opis obecnej implementacji, do sprawdzenia z końcową konfiguracją.</strong></p><h2>Działanie sklepu</h2><p>Sklep korzysta z pamięci przeglądarki, aby zachować koszyk pomiędzy wizytami. Koszyk jest zapisywany lokalnie pod nazwą innochem-cart-v2 i aktualizowany przy zmianie zawartości. Można go opróżnić w sklepie lub usunąć w ustawieniach przeglądarki.</p><p>Cookies sesji umożliwiają logowanie i ochronę dostępu do konta. Po zakupie bez konta osobny identyfikator pozwala otworzyć szczegóły danego zamówienia w tej przeglądarce; jego czas ważności wynosi do 90 dni. Identyfikatory sesji i zamówień są niedostępne dla kodu strony. Wyczyszczenie cookies może wylogować użytkownika i usunąć dostęp przeglądarki do zamówienia gościnnego.</p><h2>Analityka i reklama</h2><p>W tej wersji nie działają Google Analytics, piksele reklamowe ani zewnętrzne osadzone odtwarzacze. Fonty są serwowane ze sklepu. Dodanie narzędzi niewymaganych do działania sklepu wymaga wcześniejszego przygotowania odpowiedniej informacji i mechanizmu zgody.</p><h2>Ustawienia</h2><p>Cookies i dane witryn można sprawdzić lub usunąć w ustawieniach przeglądarki. Ograniczenie niezbędnych danych może uniemożliwić logowanie lub zapamiętanie koszyka.</p>`,
  },
];
async function main() {
  if (!process.argv.includes("--apply")) {
    console.log(
      JSON.stringify(
        pages.map((p) => ({ slug: p.slug, published: p.published })),
      ),
    );
    return;
  }
  await transaction(async (db) => {
    for (const p of pages)
      await db.query(
        "INSERT INTO pages(slug,title,body_html,meta_description,published,source_system,source_id) VALUES($1,$2,$3,$4,$5,'store-draft',$1) ON CONFLICT(slug) DO NOTHING",
        [
          p.slug,
          p.title,
          cleanHtml(p.body),
          `${p.title} — INNOCHEM, oleje i smary Royal Purple.`,
          p.published,
        ],
      );
  });
  console.log(
    "Information drafts prepared; existing content and checkout approvals unchanged.",
  );
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Information seed failed");
    process.exitCode = 1;
  })
  .finally(() => database().end());
