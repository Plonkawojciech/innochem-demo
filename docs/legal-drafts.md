# Legal content review

The information-page seed creates editable drafts. It never approves checkout, chooses delivery prices or selects a payment operator. Draft legal pages are visible only with STOREFRONT_PREVIEW enabled. Historical WordPress drafts remain hidden.

Before launch, the owner must complete the marked fields and approve the resulting documents. Saving an approval records an immutable version of all five documents and the commercial configuration. Editing a legal page disables checkout approval. Reusing a version with changed content is rejected. Each new order references its accepted revision, includes the text in the queued confirmation and provides an authenticated download. Historical imported orders do not falsely acquire a new legal version.

Sources consulted on 2026-09-23:

- [Polish Consumer Rights Act, consolidated text](https://eli.gov.pl/api/acts/DU/2024/1796/text.html): withdrawal and distance contracts. Check subsequent amendments as part of the final legal review.
- [UOKiK: non-conformity of goods](https://prawakonsumenta.uokik.gov.pl/reklamacja/niezgodnosc/): complaint remedies and response time.
- [UODO: data-subject rights](https://uodo.gov.pl/pl/493/2254): privacy information and rights.
- [Directive (EU) 2023/2673](https://eur-lex.europa.eu/eli/dir/2023/2673/oj): online withdrawal function. Polish implementation and the final applicable requirements still require verification.

The old site's ten-day withdrawal clause and historical delivery/payment prices were deliberately not treated as current approved conditions. There is no claim that a draft is a legally approved regulation.

The implemented `/odstapienie` flow accepts an explicit declaration after a separate review step, keeps its original text and receipt time, provides a private downloadable receipt and queues durable email confirmation. The CMS tracks handling separately from refunds and stock movements. This is technical functionality, not a conclusion that every applicable legal requirement has been verified. Include the final approved instructions and return address in the editable returns policy before launch.

## Do aktualizacji polityk po włączeniu GA4

Materiał do ręcznej aktualizacji dokumentów i treści CMS. Nie zmienia plików
`docs/legal/*.html` ani zatwierdzonej wersji warunków sprzedaży.

| Nazwa                             | Miejsce i czas                                                                   | Cel                                                                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `innochem-consent`                | Cookie i kopia w localStorage; 6 miesięcy, z kontrolą daty również przy odczycie | Decyzja o statystyce, wersja komunikatu i czas. Jednakowy okres dla odmowy i akceptacji.                                                                                                      |
| `innochem-consent-id`             | Cookie HttpOnly, SameSite=Lax; do roku, usuwane po skutecznym wycofaniu          | Losowy identyfikator pozwalający unieważnić zgodę i oczekujące zdarzenia backendowe, również po wygaśnięciu samej zgody. Zgoda backendowa wygasa po 6 miesiącach. Nie służy do reklamy.       |
| `innochem-consent-revoke-pending` | localStorage; do potwierdzenia wycofania przez serwer                            | Ponowienie wycofania po utracie połączenia.                                                                                                                                                   |
| `_ga`, `_ga_<ID>`                 | Cookies Google, statystyka; wyłącznie po zgodzie                                 | Identyfikatory klienta i sesji. Konfiguracja tagu ogranicza czas do 180 dni bez automatycznego przedłużania. Rzeczywisty czas i domenę należy sprawdzić w przeglądarce po podłączeniu usługi. |
| `innochem-theme`                  | localStorage                                                                     | Funkcjonalny wybór motywu.                                                                                                                                                                    |
| `innochem-last-order`             | sessionStorage                                                                   | Identyfikator ostatniego zamówienia używany w przepływie zakupu. Nie jest tokenem dostępu.                                                                                                    |

Gdy `NEXT_PUBLIC_GA4_MEASUREMENT_ID` jest puste, nie uruchamiamy Google i nie
pokazujemy kategorii Statystyka. Stopka udostępnia informację o danych niezbędnych.
Po włączeniu GA4 trzeba zatwierdzić opis dostawcy, przetwarzania i transferów,
ustawienia retencji oraz polityki w CMS. Wycofanie zatrzymuje przyszłe zbieranie;
nie usuwa automatycznie zdarzeń już otrzymanych przez Google.
