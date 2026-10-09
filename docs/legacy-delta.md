# Raport zmian przed końcowym przeniesieniem danych

`scripts/report-legacy-delta.ts` porównuje lokalne pliki: bazowy obraz danych zaimportowanych ze starego sklepu, końcowy obraz starego sklepu oraz aktualny obraz nowego sklepu. Raport wskazuje zmiany i konflikty. Domyślne polecenie działa bez bazy. Tryb `normalize-source` przygotowuje znormalizowany obraz lokalnego archiwum, a osobny `export-target` odczytuje bieżący sklep w transakcji `READ ONLY`. Żaden tryb nie zapisuje danych sklepu ani nie uruchamia istniejących importerów.

Stan na 9.10.2026: adapter i eksporter sprawdzono na syntetycznych danych, sztucznym kliencie SQL i własnej testowej bazie PostgreSQL 17. Przygotowano osobny, ograniczony etap plan/apply dla istniejących rekordów katalogu, opisany poniżej. Nie wykonano eksportu ani zapisu do bazy klientki. Zaufany baseline, końcowy snapshot, rzeczywiste projekcje i uzgodnione okno przełączenia pozostają do wykonania. Nie jest to wykonany cutover F01 ani kompletny importer całej historii.

## Uruchomienie

Pliki wejściowe i raport trzymaj w prywatnym katalogu poza Git, z prawami katalogu `0700` i plików `0600`. Każdy argument jest wymagany; skrypt nie przyjmuje `--apply`, danych z stdin ani domyślnych lokalizacji.

```sh
node --import tsx scripts/report-legacy-delta.ts \
  --baseline /private/path/baseline-normalized.json \
  --final /private/path/final-source-normalized.json \
  --target /private/path/current-storefront-normalized.json \
  --output /private/path/delta-report-new.json
```

Skrypt wymaga osobnych zwykłych plików wejściowych, po najwyżej 16 MiB, i najwyżej 100 000 wierszy łącznie na snapshot. Nie czyta symlinków wejścia. Tworzy raport wyłącznie pod nową nazwą, z prawami `0600`; istniejący plik, w tym symlink, zatrzymuje wykonanie. Kod wyjścia `0` potwierdza zapis całego raportu. Przy błędzie zapisu ewentualny częściowy plik nie jest poprawnym raportem; sprawdź go lokalnie przed kolejną próbą z nową nazwą.

stdout zawiera tylko liczbę różnic i potwierdzenie zapisu. stderr nie wypisuje ścieżek, danych wejściowych, kluczy nieznanego obiektu ani szczegółów błędów systemu plików. Nie uruchamiaj tego polecenia z `.env`; żadna zmienna integracji nie jest potrzebna.

## Przygotowanie plików przez adapter i eksporter

Adapter czyta wyłącznie jawnie wskazane lokalne pliki utworzone przez `scripts/extract-legacy.py`: `legacy-data.json` oraz odpowiadający mu `media-inventory.json`. Wytwarza znormalizowany snapshot `role: source`, bez jawnych e-maili, nazwisk, adresów i treści opisów. Pola opisowe zawierają hashe; publiczne parametry numeryczne, VAT i referencje pozostają w formacie wymaganym do porównania. Wszystkie pliki wejścia i wyjścia muszą mieścić się w 16 MiB. Nie filtruj danych bez protokołu zakresu tylko po to, żeby zmieścić się w limicie.

```sh
node --import tsx scripts/report-legacy-delta.ts normalize-source \
  --input /private/path/legacy-data.json \
  --media-inventory /private/path/media-inventory.json \
  --output /private/path/source-normalized-new.json
```

Adapter waliduje używane pola z importerów, typ string surowych kolumn, mapowania ID, stawki podatku, relacje i sumy historycznych pozycji. Przerywa pracę przy brakującej wymaganej tabeli, nieznanej nazwie tabeli, brakującym używanym polu, powtórzonym ID, dwóch polskich językach/krajach, niejednoznacznym podatku lub okładce. Dodatkowe kolumny string w rozpoznanej tabeli dopuszcza, bo ekstraktor bierze ich nazwy z dumpa SQL, a ten moduł nie posiada kompletnego DDL dawnego sklepu. W `orders` zachowuje je wyłącznie w hash słownika `source_data.original`, usuwając `secure_key` jak importer; nie traktuj tego jako walidacji całego schematu PrestaShop.

stdout adaptera zawiera liczniki jawnych wyłączeń: adresów bez zaimportowanego klienta, zamówień bez klienta, pozycji bez istniejącego produktu, produktów bez obrazu oraz rodziców kategorii spoza importu. Wskazuje też liczby wierszy rozpoznanych tabel poza zakresem, np. `wp_posts` i wariantów produktu. Brak klienta/produktu w historycznych pozycjach zachowuje jako null zgodnie z `import-history.ts`; osierocona pozycja bez zamówienia i relacja katalogowa bez produktu/kategorii przerywają wykonanie. Brak inventory zdjęcia nie zastępuje go innym obrazem.

Brak historycznego adresu faktury lub dostawy zachowuje jako pusty JSON adresu, zgodnie z importerem, ale zgłasza osobny licznik każdego przypadku. Data historycznego eventu musi być poprawnym datetime. Liczniki braków wymagają kontroli migracyjnej; narzędzie nie uzupełnia danych klienta na podstawie domysłów.

Eksporter korzysta z istniejącego pakietu `pg`, bez czytania plików konfiguracji. Wymaga jednocześnie `--confirm-read-only`, `INNOCHEM_DELTA_EXPORT_READ_ONLY=1` oraz zgodności jawnego `--database` z `PGDATABASE`. Nazwa bazy musi mieć postać `innochem` lub `innochem_...`; `PGHOST` i `PGUSER` są obowiązkowe, `PGOPTIONS` zabronione. `PGPASSWORD`, jeżeli połączenie go potrzebuje, zapewnij przez środowisko z istniejącego magazynu sekretów. Nie zapisuj go do pliku ani polecenia. Preferuj istniejącą rolę z uprawnieniami SELECT.

```sh
INNOCHEM_DELTA_EXPORT_READ_ONLY=1 node --import tsx scripts/report-legacy-delta.ts export-target \
  --database innochem \
  --output /private/path/current-storefront-new.json \
  --confirm-read-only
```

Po połączeniu eksporter wykonuje `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, ustawia UTC i lokalne timeouty: statement 5 s, lock 1 s, idle transaction 10 s. Zapytania mają stałą treść SELECT, limit 100001 wierszy i żadnych parametrów SQL pochodzących z argumentów CLI. Przekroczenie limitu zatrzymuje eksport. Transakcję zawsze kończy `ROLLBACK`; połączenie CLI zamyka w `finally`. Dostęp do tabel `payment_sessions` i `stock_movements` jest konieczny, żeby rozpoznać rezerwacje i ruchy, ale do pliku trafiają wyłącznie ich stan/liczniki. Nie eksportuje provider keys, auth, sesji płatności ani korespondencji.

Wszystkie odczyty pochodzą z jednego snapshotu PostgreSQL. Jest to spójny obraz nowego sklepu; sam eksporter nie uzgadnia tej chwili ze snapshotem starego sklepu, nie zamraża checkoutu i nie blokuje workerów. Takie okno nadal wymaga decyzji i osobnego protokołu.

Helper SQL wymaga jawnej deklaracji `dedicatedConnection: true`: używaj wyłącznie własnego, bezczynnego połączenia. Nie przekazuj wspólnego `Pool` ani klienta z trwającą transakcją. CLI tworzy nowe połączenie samodzielnie; deklaracja zapobiega przypadkowemu wykorzystaniu ogólnego interfejsu query, ale nie zastępuje odpowiedzialności wywołującego za jego pochodzenie.

Zasady izolacji i ograniczeń READ ONLY opisuje [dokumentacja PostgreSQL SET TRANSACTION](https://www.postgresql.org/docs/current/sql-set-transaction.html). Odczyt może nadal powodować wewnętrzne operacje dyskowe silnika; kod nie wykonuje poleceń zmieniających dane aplikacji.

## Format wejściowy v1

Surowy `legacy-data.json` z `scripts/extract-legacy.py` wymaga wcześniej trybu `normalize-source`. Polecenie porównania przyjmuje wyłącznie poniższy format. Każdy plik musi zawierać `schemaVersion: 1`, `role` oraz wszystkie tablice `categories`, `products`, `customers`, `addresses`, `orders`, `orderItems`; pustą tablicę zapisuj jako `[]`. Baseline i final mają `role: "source"`, target ma `role: "storefront"`. Nieznany klucz, brak wymaganego pola lub inna wersja zatrzymują raport.

Wiersz ma `legacyId` i `fields`. ID starego systemu musi być dodatnią liczbą całkowitą lub jej zapisem dziesiętnym bez zer wiodących, do `2147483647`. Liczba `16` i string `"16"` oznaczają ten sam produkt; ID produktu i klienta należą do osobnych przestrzeni. Nowy wiersz sklepu ma `legacyId: null` i obowiązkowy `targetId` będący UUID. UUID zaimportowanego wiersza jest opcjonalny, ale nie zastępuje jego legacy ID.

Referencja ma tę samą postać: `{ "legacyId": "16" }` lub `{ "legacyId": null, "targetId": "UUID" }`. Po rozwiązaniu UUID w eksporcie użyj legacy ID, jeśli wskazywany wiersz je posiada. Nie mieszaj referencji UUID-only do zaimportowanego wiersza z referencjami legacy ID. Brak wskazywanego wiersza, powtórzone ID, powtórzona relacja produktu z kategorią i cykl kategorii przerywają raport. Historia zamówienia może mieć `productRef: null`, jeśli importer zachował pozycję bez istniejącego produktu; analogicznie `customerRef: null` w zamówieniu zachowuje jawną informację o braku powiązania. Adres zawsze wymaga istniejącego klienta.

Wszystkie poniższe pola są wymagane. Pola z końcówką `Hash` zawierają SHA-256 znormalizowanej wartości JSON, wyliczony funkcją `legacyDeltaHash` z [lib/legacy-delta.ts](../lib/legacy-delta.ts). Ta funkcja sortuje klucze obiektów; kolejność zwykłych tablic zachowuje. Pusta wartość i `null` mają własne hashe, więc nie zastępuj jednego drugim. Hashe danych osobowych są pseudonimizacją i nadal wymagają prywatnego przechowywania, mimo że wynik nie ujawnia tych hashy ani wartości pojedynczych pól.

| Tablica      | Wymagane `fields`                                                                                                                                                                                                                                                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `categories` | `slugHash`, `nameHash`, `descriptionHtmlHash`, `parentRef` lub null, `visible` boolean, `position` int ≥ 0                                                                                                                                                                                                                                                |
| `products`   | `slugHash`, `skuHash`, `nameHash`, `summaryHash`, `descriptionHtmlHash`, `price`, `stock` int ≥ 0, `status` draft/active/archived, `saleMode` retail/inquiry, `weightGrams` int ≥ 0, `imagePathHash`, `imageAltHash`, `metaTitleHash`, `metaDescriptionHash`, `categoryRefs`                                                                              |
| `customers`  | `emailHash`, `firstNameHash`, `lastNameHash`, `sourceCreatedAtHash`                                                                                                                                                                                                                                                                                       |
| `addresses`  | `customerRef`, `labelHash`, `dataHash`, `archived` boolean                                                                                                                                                                                                                                                                                                |
| `orders`     | `customerRef` lub null, `emailHash`, `buyerHash`, `shippingAddressHash`, `status`, `paymentMethodHash`, `currency` trzy wielkie litery, `subtotalCents`, `shippingCents`, `totalCents`, `shippingMethodHash`, `shippingLabelHash`, `trackingNumberHash`, `stockCommitted` boolean, `termsVersionHash`, `sourceDataHash`, `createdAtHash`, `updatedAtHash` |
| `orderItems` | `orderRef`, `productRef` lub null, `productNameHash`, `skuHash`, `quantity` int > 0, `unitPrice`, `totalCents`                                                                                                                                                                                                                                            |

`products` dodatkowo wymaga pól wiersza `reserved` i `stockMovementCount`, a `orders` wymaga `reservationState` (`none`, `active`, `expired`). Nie należą one do `fields`; opisują ochronę aktualnego sklepu. Source musi podać zera dla obu pól produktu oraz `none` i status `legacy` w każdym historycznym zamówieniu. Target podaje rzeczywiste `reserved`, liczbę wpisów `stock_movements` produktu i stan rezerwacji zamówienia. Rezerwacja nie może przekraczać stanu. Nie pomijaj aktywnej rezerwacji Stripe z `reservation_expires_at = NULL`: trwające przetwarzanie płatności może nadal rezerwować towar.

Przykład składni ceny źródłowej: `{ "kind": "net", "amount": "10.000000", "taxRate": "23.000000" }`. Target może przekazać `{ "kind": "gross_cents", "amount": 1230, "taxRate": "23.00" }`. `unitPrice` ma identyczną składnię. Normalizacja odtwarza obecną formułę importerów `Math.round(Number(net) * (1 + Number(taxRate) / 100) * 100)`, również jej zachowanie zmiennoprzecinkowe, zamiast wprowadzać nowe zasady finansowe. Dopuszcza maksymalnie sześć miejsc po przecinku ceny netto; stawka VAT musi bez utraty informacji mieścić się w `numeric(5,2)` i zakresie 0–100. Kwoty w groszach mieszczą się w nieujemnym PostgreSQL integer. Raport sprawdza `totalCents = subtotalCents + shippingCents` dla zamówienia i `totalCents = unitPriceCents * quantity` dla pozycji.

## Przygotowanie projekcji z istniejących importerów

Przygotowanie rzeczywistego eksportu ma być osobnym, uzgodnionym działaniem tylko do odczytu. Nie można przekazać finalnego źródła jako baseline: baseline musi odtwarzać faktycznie zaimportowany wcześniejszy obraz. Brak archiwum i inventory użytych w tamtym imporcie lub potwierdzonego historycznego mapowania blokuje wiarygodne porównanie.

Adapter odtwarza projekcję **pierwszego importu** danego archiwum. Wcześniejsze ponowne importy mogły zachować slug, SKU, meta i inne pola, bo `ON CONFLICT` nie aktualizuje całego wiersza; istniejące historyczne zamówienie zmienia tylko `source_data`, a pozycje pomija. Jeżeli importów było kilka, trzeba odtworzyć ich kolejność i zachowane wartości z protokołu/backupów albo wyeksportować zaufany baseline z historycznego środowiska. Podanie samego ostatniego dumpa nie rozwiązuje tej zależności.

W [scripts/import-legacy.ts](../scripts/import-legacy.ts) teksty produktów i kategorii pochodzą z języka o `iso_code = pl`; VAT produktu wynika z `tax_rule` dla kraju PL, a grupa `0` oznacza VAT 0. `product.price` jest netto; stock pochodzi z `product.quantity`, kilogramy z `product.weight` zmieniają się na gramy przez `Math.round(Number(weight) * 1000)`. Status uwzględnia archiwum ID 41, 43, 44 oraz `active`. Produkt 16 ma szczególny slug `hps-5w30`. Relacje korzystają z `category_product`, a obraz z inventory i okładki `image.cover = 1`.

Opisy po konwersji muszą używać tej samej sanitacji i zamiany URL jak importer; skrót opisu korzysta z `plainText`. Obraz targetu i opis mogły już zostać świadomie poprawione w CMS, dlatego raport zachowuje je jako edycje targetu do oceny. Kategorie z ID 1, 10, 11 są niewidoczne. Brakujący `id_parent` importer zamienia na null; projekcja musi jawnie odtworzyć tę regułę przed sprawdzeniem referencji. Source powinien otrzymać skuteczne wartości pól, których stary importer nie ustawiał, np. domyślne `saleMode: retail`, a nie dowolnie zgadywane wartości.

[scripts/import-history.ts](../scripts/import-history.ts) mapuje osobno `customer.id_customer`, `address.id_address`, `orders.id_order` i `order_detail.id_order_detail`. E-mail klienta importuje po `trim().toLowerCase()`. JSON adresu zawiera pola w dokładnej postaci budowanej przez funkcję `address`; adres bez klienta trafia do `legacy_records`, a nie do tablicy `addresses` tej projekcji. Zamówienie bez klienta zachowuje null, pozycja bez produktu również. Timestamp `0000-00-00 00:00:00` importer zamienia na null. Dla porównania zastosuj identyczną interpretację `Europe/Warsaw` i canonical ISO UTC po obu stronach; literalny tekst MySQL nie jest równy timestampowi eksportowanemu przez PostgreSQL.

Adapter konwertuje poprawny datetime MySQL w `Europe/Warsaw` na ISO UTC, preferując późniejszą chwilę UTC przy jesiennej niejednoznaczności i standardowy offset przy wiosennej luce, jak PostgreSQL. Daty customer mogą być null; daty orders muszą istnieć, bo docelowe kolumny są NOT NULL. Eksporter korzysta z `Date` zwracanego przez `pg` i tej samej postaci ISO. Konwencje DST sprawdzono w testach jednostkowych, ale zgodność wersji tzdata z rzeczywistą bazą potwierdzi dopiero kontrolowany odczyt referencyjny przed migracją.

Regułę wyboru offsetu potwierdza [dokumentacja PostgreSQL dotycząca niejednoznacznych timestampów](https://www.postgresql.org/docs/current/datetime-invalid-input.html); helper pozostaje przeznaczony dla `Europe/Warsaw`, nie dla dowolnej strefy.

`orders.total_paid` i `total_shipping` importer zmienia na grosze przez `Math.round(Number(value) * 100)` bez dodatkowego VAT, a subtotal wyznacza jako total minus shipping. Netto pozycji `order_detail.product_price` zamienia na jednostkową cenę brutto z `tax_rate`, a dopiero potem mnoży przez `product_quantity`. Historyczny payment label, przewoźnik i śledzenie wymagają hashy skutecznych wartości importera; nie zastępuj ich bieżącą konfiguracją operatora. Przy aktualizacji już istniejącego zamówienia ten importer zmienia wyłącznie `source_data`, a pozycje `ON CONFLICT(legacy_id)` pomija. Wykryta w raporcie zmiana innych pól nie oznacza, że obecny importer potrafi ją bezpiecznie zastosować.

## Jak czytać wynik i wykonać przełączenie

Raport wypisuje nazwę encji, legacy ID, nazwy zmienionych pól, klasyfikację i powody ochrony. Nowy UUID-only wiersz rozpoznaje przez hash UUID. Nie wypisuje adresów, e-maili, treści opisów, kwot ani wartości pól; fingerprinty snapshotów pozwalają przywiązać decyzję do konkretnych projekcji.

`source_only` oznacza zmianę wyłącznie źródła, `target_only` wyłącznie sklepu, `same_change` identyczny wynik obu zmian. `parallel_changes` wskazuje różne pola zmienione po obu stronach, a `conflict` różne nowe wartości wspólnego pola. Osobne klasy obejmują utworzenia, kolizje utworzenia i usunięcia, w tym edytowany w sklepie wiersz usunięty w źródle. Każde usunięcie wymaga sprawdzenia relacji i obowiązków przechowywania; usunięcie źródła nie jest poleceniem skasowania historii.

Nowe zamówienia, aktywne rezerwacje i ruchy magazynowe blokują pełne nadpisanie. Zmiana źródłowego stanu produktu dostaje dodatkowe powody, jeśli target posiada rezerwacje, ruchy lub nowe pozycje zamówień; raport wskazuje też zejście poniżej zarezerwowanej ilości oraz usunięcie produktu nadal powiązanego z pozycją zamówienia. `fullOverwriteAllowed` zawsze wynosi false, a `automaticApplySupported` false, również przy zerowej liczbie różnic.

W uzgodnionym oknie wykonaj backup oraz spójny końcowy snapshot starego sklepu i nowego sklepu. Zapisz ich pochodzenie i SHA-256 w prywatnym protokole. Przygotuj i sprawdź projekcje, wygeneruj raport, następnie rozpatrz każdą zmianę targetu i konflikt. Dopiero osobno przejrzany importer delta z kontrolą wersji/rezerwacji, kopią i testem odtworzenia może wykonać zatwierdzone zmiany. Obecnego `db:import --apply` nie używaj jako zamiennika takiego importera; już teraz blokuje pełny import po pojawieniu się nowych zamówień.

Zakres tego raportu nie obejmuje bajtów mediów, stron CMS, przekierowań, eventów i dodatkowych `legacy_records`, kont auth, konfiguracji operatorów, sesji płatności, przesyłek ani kolejek poczty/analityki. Końcowy protokół migracji musi objąć również te zasoby. Brak różnic w tym module nie jest akceptacją przełączenia domeny.

Testy modułu uruchomisz bez DB: `node --import tsx --test tests/legacy-delta.test.ts`. Sprawdzają syntetyczne scenariusze zmian, finansowe mapowanie, referencje, rezerwacje, brak ujawniania wartości, brak mutacji wejścia i lokalny zapis raportu. Adapter i sztuczny klient SQL dają porównanie bez różnic dla niezależnie zbudowanej projekcji pierwszego importu. Testy kontrolują READ ONLY, stałe SELECT, timeouty, rollback również przy błędzie i guardy CLI. Nie potwierdzają rzeczywistego eksportu ani danych klientki.

## Ograniczony etap plan/apply istniejącego katalogu

[scripts/apply-legacy-catalog-delta.ts](../scripts/apply-legacy-catalog-delta.ts) domyślnie wykonuje dry-run. Czyta cztery prywatne pliki oraz aktualny target w transakcji `REPEATABLE READ READ ONLY`, sprawdza zgodność targetu z podanym eksportem i zapisuje nowy plan `0600`. W przeciwieństwie do samego reportera wymaga połączenia z jawnie wskazaną bazą. Wszystkie wejścia muszą być zwykłymi plikami `0600`, bez symlinków i po najwyżej 16 MiB. Przechowuj je w prywatnym katalogu `0700` poza Git; folder przygotowuje prowadzący, skrypt nie zmienia jego praw.

Obsługiwane aktualizacje dotyczą wyłącznie już istniejącego `legacyId` i potwierdzonego UUID oraz wersji:

| Encja        | Pola                                                                             |
| ------------ | -------------------------------------------------------------------------------- |
| `products`   | `priceCents`, `taxRateBasisPoints`, `stock`, `status`, `saleMode`, `weightGrams` |
| `categories` | `visible`, `position`                                                            |

Plan zachowuje niezależne zmiany targetu. Nie zapisuje pola, które po obu stronach osiągnęło już tę samą wartość. Jakikolwiek konflikt, utworzenie źródłowego wiersza, delete, zmiana relacji, tekstu, PII, zamówienia, adresu lub innego nieobsługiwanego pola blokuje **cały** apply; skrypt nie stosuje tylko części poprawnych operacji. Hash tekstu nie pozwala odtworzyć jego wartości, dlatego narzędzie nie tworzy nowych kategorii, produktów, klientów ani historycznych zamówień. Nowe wiersze istniejące wyłącznie w target są zachowywane.

Źródłowa zmiana stanu produktu z rezerwacją, ruchami magazynowymi lub referencją z nowego zamówienia wymaga odrębnego review. Statusu i trybu sprzedaży produktu z rezerwacją też nie zmienia. Skuteczny stan produktu nie może mieć stock poniżej reserved ani aktywnej detalicznej sprzedaży z ceną zero. Zmiana ceny dodaje wpis `price_history` w tej samej transakcji.

Wersjonowany plik provenance ma poniższy kształt. `snapshotHash` to `legacyDeltaHash` dokładnego JSON wejścia, przed normalizacją. Pozostałe SHA-256 wiążą prywatne archiwa i protokoły; przygotuj je na podstawie rzeczywistych materiałów, nie placeholderów. Narzędzie sprawdza strukturę i wiązanie snapshotów, ale **nie dowodzi**, że deklarowane archiwum, backup czy freeze wykonano. Kontrola pochodzenia i odbiór backupu pozostają obowiązkiem prowadzącego cutover.

```json
{
  "schemaVersion": 1,
  "baseline": {
    "snapshotHash": "SHA256 canonical JSON baseline",
    "archiveHash": "SHA256 original archive bytes",
    "mediaInventoryHash": "SHA256 inventory bytes",
    "importProtocolHash": "SHA256 verified historical import protocol"
  },
  "final": {
    "snapshotHash": "SHA256 canonical JSON final source",
    "archiveHash": "SHA256 final archive bytes",
    "mediaInventoryHash": "SHA256 final inventory bytes",
    "freezeProtocolHash": "SHA256 agreed and completed freeze protocol"
  },
  "target": {
    "snapshotHash": "SHA256 canonical JSON target export",
    "database": "innochem",
    "backupReceiptHash": "SHA256 independently checked backup receipt"
  }
}
```

Powyższe opisy SHA są przykładem dokumentacji; prawidłowy plik wymaga 64 małych znaków hex dla każdego hasha. Plan zawiera dokładne fingerprinty wszystkich projekcji, provenance, UUID/version, hashe aktualnych wierszy, jawne pola i wartości katalogowe operacji, blokady, hash całego planu oraz termin ważności 30 minut. Maksymalnie dopuszcza 5000 operacji. Kwoty, stany i UUID pozostają w prywatnym pliku planu; stdout zawiera wyłącznie liczniki i hash planu.

```sh
INNOCHEM_DELTA_EXPORT_READ_ONLY=1 node --import tsx scripts/apply-legacy-catalog-delta.ts \
  --baseline /private/path/baseline.json \
  --final /private/path/final.json \
  --target /private/path/target.json \
  --provenance /private/path/provenance.json \
  --database innochem \
  --output /private/path/catalog-plan-new.json
```

Przed apply prowadzący musi sprawdzić cały plan i pochodzenie, wykonać uzgodniony backup/restore oraz faktycznie zamknąć checkout i zatrzymać workerów starego i nowego sklepu. CLI wymaga `INNOCHEM_DELTA_CATALOG_APPLY=1`, `INNOCHEM_DELTA_FREEZE_CONFIRMED=1`, `PAYMENTS_ENABLED=false`, `MAIL_DELIVERY_ENABLED=false`, `STORE_WORKER_ENABLED=false`, a baza `settings.store.checkoutEnabled` musi być dokładnie false. Zmienne procesu nie dowodzą zatrzymania innych procesów; ten stan potwierdza osobny protokół. `PGHOST`/`PGUSER` muszą istnieć, `PGDATABASE` musi odpowiadać `--database`, a `PGOPTIONS` jest zabronione. Sekrety zapewnia istniejące środowisko, bez plików `.env` i bez wypisywania hasła.

```sh
node --import tsx scripts/apply-legacy-catalog-delta.ts \
  --baseline /private/path/baseline.json \
  --final /private/path/final.json \
  --target /private/path/target.json \
  --provenance /private/path/provenance.json \
  --database innochem \
  --apply --plan /private/path/catalog-plan-new.json \
  --confirm-plan-hash EXACT_REVIEWED_PLAN_HASH
```

Apply używa własnego połączenia, transakcji `SERIALIZABLE`, obu advisory locks istniejących importerów (`842615913` i `842615914`) oraz stałej listy blokad tabel `SHARE ROW EXCLUSIVE`. Blokady wstrzymują konkurencyjne zapisy do tabel projekcji, stanu magazynu, audytu importu i ustawień podczas tej transakcji; nie zamrażają zewnętrznego sklepu ani bajtów mediów. Timeout zapytania wynosi 5 s, lock 1 s, bezczynnej transakcji 10 s. Przed każdym zapisem i commit sprawdza również 30-sekundowy budżet własnej operacji i ważność planu; trwające zapytanie ogranicza jego własny timeout.

Pod blokadami narzędzie ponownie odczytuje cały target, wersje i wszystkie używane migracje oraz odtwarza plan. Każda zmiana targetu, nawet poza aktualizowanym wierszem projekcji, niezgodny UUID/version, hash, otwarty checkout, wygasły plan lub nieznany schemat zatrzymuje całość. Wymaga dokładnego ledgeru 17 migracji i znanego fingerprintu kolumn, constraints oraz triggerów tabel używanych do projekcji i zapisów, uzyskanego na czystej testowej bazie PostgreSQL 17. Inna wersja DDL lub formatowania metadata wymaga odrębnego sprawdzenia; nie usuwaj guardów, żeby przepchnąć cutover. Fingerprint nie obejmuje konfiguracji całego serwera ani wszystkich zasobów poza zakresem tego modułu.

Kolumny SQL pochodzą wyłącznie z allowlisty, wartości są parametrami. Aktualizacja wymaga UUID, legacy ID i wcześniejszej wersji, zwiększa wersję o jeden; product zmienia też `updated_at`. Wpis `import_runs` przechowuje hash planu, fingerprinty, hash provenance i licznik operacji. Ponowne wykonanie tego planu odrzuca jako stale albo zapisany już run; nie wykonuje zmian ani nie dodaje powtórnej historii cen. Błąd dowolnej operacji cofa wcześniejsze aktualizacje, wersje, historię cen i wpis run razem. Narzędzie nie uruchamia maila, płatności, workerów, zamówień ani API operatorów.

Testy bez DB: `node --import tsx --test tests/legacy-delta-apply.test.ts`. Odrębny, jawny tryb syntetyczny tworzy nową bazę `innochem_test_delta_apply_*` na lokalnym PG 55439, nakłada znane migracje i używa tylko sztucznych rekordów. Bazę zachowuje po testach, zamyka własne połączenia i usuwa własny katalog plików testu CLI.

```sh
INNOCHEM_DELTA_DB_TEST=1 PGHOST=/tmp/innochem-postgres PGPORT=55439 \
PGUSER=wojciechplonka node --import tsx --test tests/legacy-delta-apply.test.ts
```

Sprawdzone syntetycznie: READ ONLY plan, prywatny i wyłączny zapis CLI, odrzucenie symlinków/publicznych plików, jawne apply przez CLI, rollback po drugiej operacji, idempotency, stale stock i same-value version change, dwa równoległe apply z jednym commit, blokada przez drugi klient SQL, wygasły/tampered plan oraz guards checkout/provenance/schema. Te wyniki potwierdzają ograniczony etap katalogu. Pełne uzupełnienie historii, nowych encji i raw payload nadal wymaga zaufanego baseline/raw eksportu, mapowania i osobnego uzgodnienia oraz testów; rzeczywistego F01 cutover nie wykonano.
