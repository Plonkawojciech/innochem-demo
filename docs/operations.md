# Uruchomienie i obsługa sklepu

Konfiguracja jest przygotowana do własnej VM i Coolify. Samo dodanie plików do repo nie uruchamia sklepu. Domyślnie podgląd, płatności, SMTP i zadania okresowe pozostają wyłączone. Nie podłączaj danych klientów do publicznego środowiska demonstracyjnego.

## Sekrety i adresy

Wprowadź wartości w menedżerze sekretów wdrożenia. Nie zapisuj ich w repo, poleceniach historii terminala ani w wiadomościach.

| Zmienna Compose | Znaczenie |
| --- | --- |
| `INNOCHEM_APP_URL` | Docelowy adres HTTPS. Musi odpowiadać domenie używanej przez klientów. |
| `INNOCHEM_DATABASE_PASSWORD` | Osobne hasło PostgreSQL. Baza nie ma publicznego portu. |
| `INNOCHEM_AUTH_SECRET` | Losowy sekret uwierzytelniania, co najmniej 32 znaki. Zachowaj między wdrożeniami. |
| `INNOCHEM_WORKER_SECRET` | Inny losowy sekret, co najmniej 32 znaki. |
| `INNOCHEM_BACKUP_KEY` | Losowe 32 bajty zapisane jako base64. Przechowuj oddzielnie od archiwów. |
| `INNOCHEM_STRIPE_SECRET_KEY`, `INNOCHEM_STRIPE_WEBHOOK_SECRET` | Sekret serwerowy Stripe i podpis konkretnego endpointu webhook. |
| `INNOCHEM_SMTP_HOST/PORT/USER/PASSWORD`, `INNOCHEM_MAIL_FROM` | Potwierdzony serwer poczty i nadawca. Port 465 albo 587 z TLS. |
| `INNOCHEM_BACKUP_DIRECTORY` | Trwały katalog kopii poza wolumenem aplikacji. |

Przełączniki `INNOCHEM_PREVIEW`, `INNOCHEM_MAIL_ENABLED`, `INNOCHEM_WORKER_ENABLED`, `INNOCHEM_PAYMENTS_ENABLED` są niezależne. Stan domyślny: `true`, `false`, `false`, `false`. W podglądzie nie można wysyłać maili ani pobierać rzeczywistych płatności, nawet po przypadkowym włączeniu pozostałych przełączników.

Wiadomości powstałe w podglądzie mają trwałe oznaczenie `preview`. Worker pomija je także po późniejszym włączeniu SMTP i wyłączeniu podglądu. Nie zmieniaj tego oznaczenia, aby ponownie wykorzystać korespondencję testową.

`INNOCHEM_TRUST_PROXY=true` włącz dopiero po sprawdzeniu, że publiczny reverse proxy **nadpisuje** `X-Real-IP` rzeczywistym adresem klienta, usuwa wartość przesłaną przez klienta i jest jedyną drogą do aplikacji. Przetestuj próbę podstawienia tego nagłówka. Bez tego aplikacja używa wspólnego limitu żądań. Baza pozostaje wyłącznie w prywatnej sieci `store`; tylko aplikacja otrzymuje sieć wyjściową i połączenie z proxy Coolify.

## Przygotowanie wydania

1. Zapisz identyfikator commita i wynik testów. Zbuduj obraz `web` oraz obraz narzędzia `backup`. Sprawdź `docker compose config --quiet` bez wypisywania rozwiniętej konfiguracji z sekretami.
2. Uruchom samą bazę: `docker compose up -d database`. Migracje: `docker compose --profile operations run --rm migrate`. Skrypt blokuje równoczesne migracje i odrzuca zmienione pliki już zastosowanych migracji.
3. Dla przenoszonego sklepu odtwórz zweryfikowaną kopię w pustej bazie i w pustym wolumenie mediów, przy wyłączonym WWW i workerze. Nie nakładaj odtworzenia na bazę zawierającą nowe zamówienia. Właścicielem plików mediów w kontenerze aplikacji musi być UID/GID 1001.
4. Ustaw sekrety i uruchom `web`. `/api/health` ma zwrócić 200 po dostępności bazy i wymaganego schematu. Sprawdź logowanie, odczyt/importowane historie, obraz i PDF, zapis szkicu oraz upload nowego pliku.
5. Utwórz administratora za pomocą `node operations/bootstrap-admin.mjs`, przekazując bezpiecznie `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` (minimum 16 znaków) i `ADMIN_IDENTITY_VERIFIED=true`. Skrypt wymaga potwierdzonej tożsamości, nie nadpisuje istniejącego konta, nie promuje klienta i nie wysyła wiadomości. Konta historyczne korzystają z resetu hasła po potwierdzeniu skrzynki.
6. Testy operatora wykonaj na odrębnym środowisku z danymi syntetycznymi. Dopiero po akceptacji treści i parametrów sprzedaży zatwierdź ich wersję w panelu. Otworzenie zakupów wymaga wszystkich zgód zapisanych w ustawieniach.
7. Przed przełączeniem domeny zamknij przyjmowanie zamówień w starym sklepie na uzgodnione okno, pobierz końcowy przyrost danych i wykonaj nową kopię. Porównaj klientów, zamówienia, pozycje, magazyn i pliki. Dopiero potem przełącz ruch i włącz uzgodnione funkcje. Przeniesienie WWW nie zmienia automatycznie MX ani konfiguracji Outlooka.
8. W Coolify przypnij domenę HTTPS wyłącznie do `web:3000`. Nie podłączaj bazy do wspólnej sieci innych projektów. Nie wystawiaj portu PostgreSQL. Włącz worker po zatwierdzeniu SMTP i pozostałych czynności. Harmonogram wywołuje kolejkę co minutę.

## Stripe

Przygotowany jest Stripe Checkout na stronie operatora, PLN. Metody pochodzą z aktywnej konfiguracji Dashboard i kwalifikacji konta; żądanie nie wymusza statycznie niedostępnej metody. Weryfikacja 08.10.2026 na koncie INNOCHEM: BLIK, Cards, Apple Pay i Google Pay Enabled; P24 Ineligible / Unsupported business. Wymaga wyjaśnienia przez operatora, zanim można potwierdzić obsługę P24. Apple Pay udostępnia Stripe w płatności kartą na obsługiwanym urządzeniu z aktywnym portfelem. Nie jest osobną wartością `payment_method_types`.

W panelu operatora aktywuj wymagane metody i zakończ weryfikację firmy. Endpoint:

`https://DOCZELOWA-DOMENA/api/payments/stripe/webhook`

Zdarzenia: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`. Ustaw podpis tego endpointu. Przekierowanie przeglądarki do strony sukcesu nie potwierdza zapłaty. Aplikacja sprawdza podpis surowego żądania, odczytuje bieżącą sesję ze Stripe i porównuje zamówienie, kwotę, walutę oraz tryb. Ponowienia są idempotentne.

Tryb testowy: `INNOCHEM_STRIPE_MODE=test`, klucze testowe, `INNOCHEM_PAYMENTS_ENABLED=true`; dla prywatnego podglądu dodatkowo `INNOCHEM_STRIPE_TEST_CHECKOUT_ENABLED=true`. Wymaga też metody Stripe w ustawieniach oraz syntetycznie zatwierdzonych warunków testowego sklepu. Tryb rzeczywisty wymaga oddzielnej decyzji, `live`, kluczy rzeczywistych i wyłączenia podglądu. Nie przenoś testowych zgód handlowych do właściwej bazy.

Test odbiorczy po podłączeniu operatora: karta, BLIK, Przelewy24, Apple Pay na zgodnym urządzeniu, przerwanie płatności, opóźniony wynik i ponowiona dostawa webhooka. Potwierdź zamówienie, pojedynczy ruch magazynowy, pojedyncze potwierdzenie w kolejce i stan w panelu operatora. Testy lokalne z atrapą transportu nie zastępują tych prób.

Jeśli tworzenie sesji przerwało się bez odpowiedzi, nie anuluj rezerwacji na podstawie samego timeoutu. Panel oznacza taki przypadek. Odszukaj sesję według `metadata.orderId` w Stripe i użyj „Sprawdź płatność w Stripe” z jej identyfikatorem. Serwer weryfikuje powiązanie przed zapisem. Rozpoczęte płatności bankowe zachowują rezerwację do definitywnego wyniku. Anulowanie sesji otwartej najpierw wygasza ją u operatora. Płatność po wcześniejszym anulowaniu trafia do wyjaśnienia, bez automatycznego odejmowania towaru.

Dokumentacja operatora sprawdzona 23.09.2026: [BLIK](https://docs.stripe.com/payments/blik), [Przelewy24](https://docs.stripe.com/payments/p24), [Apple Pay](https://docs.stripe.com/apple-pay), [potwierdzanie płatności Checkout](https://docs.stripe.com/checkout/fulfillment), [tworzenie sesji](https://docs.stripe.com/api/checkout/sessions/create). Wybór integracji nie jest aktywacją operatora ani potwierdzeniem warunków cenowych.

## Obsługa odstąpień

Formularz `/odstapienie` jest dostępny bez konta oraz z odnośnika przy zamówieniu. Klient sprawdza dane przed osobnym potwierdzeniem. System zachowuje oryginalne oświadczenie, datę otrzymania i potwierdzenie do pobrania; zapisuje również potwierdzenia w kolejce pocztowej. W podglądzie są to wyłącznie zgłoszenia testowe i wiadomości trwale wyłączone z wysyłki.

W panelu „Odstąpienia” obsługa zmienia status i notatkę wewnętrzną. Te zmiany nie modyfikują oświadczenia klienta. Zwrot płatności, przyjęcie towaru i rozliczenie zamówienia wymagają odrębnych czynności po sprawdzeniu sprawy. Funkcja nie zastępuje zatwierdzenia aktualnego regulaminu i wymogów prawnych.

## Kopie i odtworzenie

`scripts/backup.mjs` tworzy osobny, nowy katalog. Szyfruje bazę, oryginalne media i spis zawartości AES-256-GCM. Nie nadpisuje istniejącej kopii. Klucz nie znajduje się w archiwum. Media muszą być zwykłymi plikami, bez dowiązań. Przed kopią wstrzymaj zapisy aplikacji i workera, następnie ustaw `BACKUP_QUIESCED=true` (w Compose `INNOCHEM_BACKUP_QUIESCED=true`). Skrypt sprawdza także, czy podczas kopiowania nie zmieniły się dane ani pliki.

Przykład po zatrzymaniu zapisów:

```
docker compose --profile operations run --rm backup backup /backups/UNIKALNY-ZNACZNIK-CZASU
```

Próba odtworzenia jest ograniczona do lokalnego socketu PostgreSQL i **nowej** bazy `innochem_restore_*`. Uwierzytelnia archiwum przed interpretacją danych, odtwarza pliki z kontrolą ścieżek i porównuje SHA-256 każdej tabeli, sekwencje oraz każde medium.

```
node scripts/backup.mjs restore-test KATALOG-KOPII NOWY-KATALOG-TESTU innochem_restore_UNIKALNA_NAZWA
```

Na Macu `scripts/local-backup.py` pobiera klucz bezpośrednio z Keychain; nie wyświetla go. Katalog testowego odtworzenia zawiera odszyfrowane dane, ma uprawnienia prywatne i musi pozostać poza repo i publicznym WWW. Nie usuwaj go ani nie czyść bazy bez osobnej decyzji właściciela. Nie uruchamiaj odtworzonej kopii z aktywnym SMTP lub płatnościami.

Zaproponowany harmonogram eksploatacji: kopia przed każdym wydaniem i regularna kopia poza VM; częstotliwość oraz retencję zatwierdza właściciel. Skrypt niczego automatycznie nie usuwa. Trzymaj drugi egzemplarz poza hostem i okresowo ponawiaj test odtworzenia. Utrata klucza uniemożliwi odczyt kopii; sam klucz w Keychain jednego komputera nie jest niezależną kopią klucza.

## Monitoring i powrót do poprzedniego wydania

Sprawdzaj `/api/health`, stan kontenera workera, wolne miejsce, datę poprawnej kopii, błędy webhooków i kolejkę wiadomości w panelu. Wiadomość ze stanem `uncertain` mogła zostać przyjęta przez SMTP: wyjaśnij wynik u dostawcy przed ponowieniem. Nie traktuj wpisu do kolejki jako wysłania maila.

Rollback kodu korzysta z wcześniej zachowanego obrazu. Jeśli po uruchomieniu wpłynęły nowe zamówienia, zachowaj nową bazę i jej kopię; nie przywracaj starego dumpa na działającą bazę. Zamknij checkout, uzgodnij płatności i dopiero wybierz sposób naprawy. Każda destrukcyjna migracja lub odtworzenie istniejącej produkcyjnej bazy wymaga oddzielnej zgody.

## Apaczka

Integracja służy do nadawania przesyłek w panelu zamówień. Koszyk nadal używa stałych stawek `shippingMethods` z Ustawień sklepu. Wycena API jest dostępna w kliencie serwerowym, ale nie zmienia ceny zamówienia.

Ustaw na serwerze `APACZKA_APP_ID` i `APACZKA_APP_SECRET`. Obie zmienne są wymagane; bez nich panel pokazuje „Integracja Apaczka nie jest skonfigurowana”, a API zwraca `APACZKA_DISABLED`. Nie zapisuj kluczy w repozytorium ani w formularzu ustawień. Po zmianie środowiska uruchom ponownie aplikację.

Według [oficjalnej dokumentacji Web API v2](https://panel.apaczka.pl/dokumentacja_api_v2.php), odczytanej 2026-10-01, dostęp do API wymaga umowy i aktywacji przez wsparcie lub opiekuna Apaczki. W panelu Apaczki otwórz zakładkę **Web API**, dodaj aplikację i pobierz wygenerowane App ID oraz App Secret. Oficjalny SDK jest podlinkowany jako [archiwum PHP](https://panel.apaczka.pl/files/sdk-apiv2-0.3.zip); w tej sesji odczyt ZIP nie był dostępny, a wyszukiwanie nie wykazało oficjalnego repozytorium GitHub.

Przed uruchomieniem zastosuj migrację `015_shipments.sql` standardowym poleceniem `npm run db:migrate` w środowisku docelowej bazy. Tworzy tabelę `shipments`, indeks zamówienia, unikalność identyfikatora operatora i unikalność aktywnej przesyłki zamówienia. Nie zmienia istniejących zamówień. Panel używa `orders.shipping_address`, `buyer`, `email` oraz `tracking_number`.

W **Ustawieniach sklepu → Apaczka: nadawca i paczki** sprawdź adres, osobę kontaktową, telefon i e-mail. Początkowy telefon i e-mail pochodzą z istniejących domyślnych danych kontaktowych serwisu; nie synchronizują się automatycznie z późniejszymi zmianami kontaktu. Istniejący preset „Karton 4 butelki” 30 × 20 × 25 cm, 5 kg jest przykładem do usunięcia lub zastąpienia po otrzymaniu prawdziwych wymiarów i masy. Nie traktuj go jako potwierdzonego opakowania INNOCHEM. Dodaj rzeczywiste presety opakowań. Dla pobrania uzupełnij `bankAccount` polskim NRB (26 cyfr; spacje i prefiks PL są usuwane). Kwota pobrania to `total_cents`, razem z dostawą, w groszach PLN.

Przyjęte ograniczenia i kwestie do potwierdzenia na koncie:

- Lista obejmuje krajowe usługi drzwi–drzwi. Punkty odbioru i przesyłki zagraniczne wymagają dodatkowych danych, których obecny model zamówienia nie przechowuje.
- Bez daty wysyłamy `pickup.type=SELF`. Data wybiera `COURIER`; godziny pochodzą z `pickup_hours` dla tej usługi, kodu nadawcy i daty. Usługi wymagające kuriera nie pozwalają pominąć daty. Trzeba potwierdzić dostępność usług, terminy i umowę na koncie. Nie zgadujemy godzin odbioru. Cache godzin trwa 30 minut; przyjęto, że pole `hours[date].services[].service` zawiera identyfikator usługi. Dokumentacja pokazuje puste wartości tego pola, więc ten format trzeba potwierdzić na koncie. Inny format przerwie nadanie przed `order_send`.
- `order` przekazujemy jako obiekt wewnątrz JSON w polu formularza `request`, zgodnie z przykładami endpointów. Fragment dokumentacji struktury zawiera również `json_encode`; nie kodujemy obiektu drugi raz. `option` to pusty obiekt, bez dodatkowo płatnych opcji; zawartość to „Produkty INNOCHEM”, paczka standardowa `PACZKA`, `is_zebra=0`. Zgodność zawartości i opakowania z warunkami przewoźnika trzeba potwierdzić przed rzeczywistym nadaniem.
- Cache listy usług w pamięci trwa 1 h zgodnie z zadaniem, choć dokumentacja zaleca nie częściej niż 24 h. Restart procesu usuwa cache. Uzgodnij tę częstotliwość z Apaczką przed uruchomieniem na dużej liczbie instancji.
- Brak numeru listu po przyjęciu zlecenia nie powoduje ponownego nadania. Pobranie etykiety odczytuje wtedy szczegóły przez `order/:id/` i uzupełnia numer.

Każda próba nadania najpierw zapisuje `order_events.kind=shipment_pending` i audyt. Blokada zamówienia chroni przed równoległym kliknięciem. Po sukcesie wpis przechodzi do `shipment_created`. Jawne odrzucenie API przechodzi do `shipment_rejected` i pozwala poprawić dane. Timeout, niepoprawna odpowiedź lub błąd zapisu po stronie sklepu pozostawia blokadę. Nie ponawiaj nadania w ciemno: administrator techniczny musi sprawdzić konto Apaczki, powiązać istniejące zlecenie z zamówieniem lub potwierdzić brak zlecenia i dopiero wtedy rozliczyć wpis oczekujący. API nie dokumentuje klucza idempotencji, więc integracja go nie wymyśla. Nie usuwa automatycznie blokady po czasie.

Anulowanie dotyczy przesyłki, nie zamówienia ani płatności. Po potwierdzeniu operatora ustawiamy `cancelled`, zapisujemy historię i audyt oraz usuwamy numer zamówienia wyłącznie, jeśli nadal odpowiada anulowanemu listowi. Przy niejednoznacznym wyniku anulowania sprawdź stan zlecenia w Apaczce przed następną próbą. Trwały wpis `shipment_cancel_pending` blokuje powtórne anulowanie po utracie odpowiedzi; po jawnym odrzuceniu zmienia się na `shipment_cancel_rejected`. Nie ma automatycznego śledzenia doręczeń. Nadanie nie oznacza automatycznie zamówienia jako wysłanego.

## Preflight konfiguracji wydania

Przed otwarciem sklepu uruchom w kontenerze aplikacji, jako użytkownik aplikacji:

```sh
docker compose exec web node operations/preflight.mjs
```

Lokalny odpowiednik to `node --import tsx scripts/preflight.ts`; skrypt korzysta wyłącznie ze środowiska procesu. Wypisuje `OK`, `BRAK` lub `BŁĄD` przy każdej sprawdzanej zmiennej, bez jej wartości ani fragmentów. Błąd daje kod wyjścia 1. Sprawdza URL HTTPS bez końcowego ukośnika, różne sekrety auth i workera o długości co najmniej 32 znaków, obecność konfiguracji DB, dostępność zapisu w katalogu mediów oraz przełączniki. Włączenie poczty lub płatności wymaga odpowiednich zmiennych integracji; publiczne ID GA4 wymaga `GA4_API_SECRET`. Kontrola nie łączy się z bazą ani dostawcami i nie potwierdza działania ich usług.

`NEXT_PUBLIC_GA4_MEASUREMENT_ID` trafia do obrazu przez argument builda oraz do środowiska runtime. Zmiana ID wymaga **przebudowy obrazu**; w Coolify zaznacz dla tej zmiennej **Build variable** i zapewnij tę samą wartość runtime. `GA4_API_SECRET` pozostaje wyłącznie zmienną runtime. Compose przekazuje obie zmienne pod tymi nazwami.

`/api/health` porównuje `schema_migrations.name` z manifestem wydania `lib/server/migrations-manifest.ts`. Brak migracji daje HTTP 503 i listę `missing`; błędy połączenia nie ujawniają szczegółów. Przy dodaniu migracji uzupełnij manifest; zgodność sprawdza test.

W panelu płatności pole „Limit pobrania (zł, 0 = bez limitu)” zapisuje `codLimitCents` w groszach. Limit obejmuje produkty i dostawę, a kwota równa limitowi jest dozwolona. Istniejące ustawienia bez pola przyjmują 0. Zmiana limitu wymaga nowej zatwierdzonej wersji warunków, tak jak zmiana metod dostawy.

## Tryby integracji i wdrożenie migracji 016–017

Compose przekazuje `APACZKA_APP_ID`, `APACZKA_APP_SECRET`, `APACZKA_MODE` (domyślnie `sandbox`) i `APACZKA_LIVE_SHIPPING_ENABLED` (domyślnie `false`) z odpowiadających im zmiennych `INNOCHEM_APACZKA_*`. Sandbox używa osobnego konta i kluczy operatora. Nadanie lub anulowanie w `live` wymaga jednocześnie `STOREFRONT_PREVIEW=false` i `APACZKA_LIVE_SHIPPING_ENABLED=true`. Sam odczyt wyceny nie składa zlecenia. Panel wymaga aktualnej, pięciominutowej wyceny związanej z operatorem, paczkami, zamówieniem i zalogowaną osobą.

Migracja 017 zapisuje tryb przesyłki i rozdziela unikalność zleceń sandbox/live. Stare przesyłki otrzymują `unknown`: trzeba sprawdzić rzeczywiste środowisko u operatora i udokumentować przypisanie, zanim będą pobierane etykiety lub wykonywane anulowanie. Wpisy o niejednoznacznym wyniku bez historycznego trybu blokują dalsze nadanie. Nie kopiuj identyfikatorów przesyłek między środowiskami. Zamówienie po refundacji lub przyjęciu zwrotu wymaga wyjaśnienia zakresu wysyłki; panel nie nadaje automatycznie pierwotnego pełnego koszyka i pobrania.

Migracja 016 zmienia klucz unikalności kolejki analitycznej. Stary kod wymaga poprzedniego indeksu; nie uruchamiaj starego i nowego wydania równocześnie przy tej migracji. Sekwencja: przygotuj i przetestuj nowy obraz; potwierdź wyłączony checkout i brak trwających transakcji; wykonaj backup; zatrzymaj procesy zapisujące (web/worker); zastosuj migracje nowym obrazem; uruchom wyłącznie nowe wydanie; sprawdź `/api/health`, liczniki danych i kolejki. Cofnięcie samego obrazu do wydania sprzed 016 nie jest zgodnym rollbackiem. W razie problemu popraw nowe wydanie albo przeprowadź uzgodnione odzyskanie kompletnego snapshotu w osobnym środowisku.

Worker zwraca osobno `enabled`, `healthy`, `errors` i `warnings`. Wyłączona kolejka może być osiągalna; nie oznacza to aktywnego przetwarzania. Wyjątek całej kolejki odbiera heartbeat, ale nie blokuje pozostałych kolejek. Błędy pojedynczych zadań trafiają do liczników i `warnings`, wymagających monitorowania; nie oznaczają zatrzymania procesu. Log zawiera nazwy kolejek i liczniki, bez danych kupującego i sekretów.

Rozliczenie refundacji dopuszcza osobną korektę kwoty z ilością 0; przyjęcie sztuk do magazynu nadal wymaga dodatniej ilości i osobnego zdarzenia. Zwrot samej dostawy lub korekta kwoty nie wysyła standardowego GA4 `refund` bez poprawnych pozycji: jest zachowany lokalnie jako `skipped / refund_adjustment`, aby nie raportować nieprawdziwego pełnego zwrotu ani dzielenia przez zero. Przy mieszanym rozliczeniu GA4 otrzymuje dodatnie ilości i ich kwoty; korekty z ilością 0 pozostają w finansowej historii zamówienia, a nie w standardowych metrykach refundowanych produktów. Standardowe zwroty wskazanych produktów trafiają do GA4 z osobnym identyfikatorem każdej operacji.

Format kopii v2 używa sortowania `COLLATE "C"` dla fingerprintu tabel, wierszy i sekwencji. Dzięki temu odtworzenie między Linuxem i macOS nie zależy od różnic bibliotek lokalizacji. Odczyt v1 pozostaje obsługiwany z oryginalnym sposobem liczenia; przy odtwarzaniu historycznych kopii na innej platformie nie wolno ignorować różnicy fingerprintu. Klucz szyfrowania jest ten sam i nie trafia do manifestu.
