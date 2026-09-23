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

Przygotowany jest Stripe Checkout na stronie operatora: `card`, `blik`, `p24`, PLN. Apple Pay udostępnia Stripe w płatności kartą na obsługiwanym urządzeniu z aktywnym portfelem. Nie jest osobną wartością `payment_method_types`.

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
