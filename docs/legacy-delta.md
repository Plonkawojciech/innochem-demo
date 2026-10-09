# Raport zmian przed końcowym przeniesieniem danych

`scripts/report-legacy-delta.ts` porównuje lokalne pliki: bazowy obraz danych zaimportowanych ze starego sklepu, końcowy obraz starego sklepu oraz aktualny obraz nowego sklepu. Raport wskazuje zmiany i konflikty. Nie łączy się z bazą, nie pobiera eksportów, nie zapisuje danych sklepu ani nie uruchamia istniejących importerów.

Stan na 9.10.2026: implementację sprawdzono wyłącznie na syntetycznych danych. Końcowy snapshot klientki, przygotowanie rzeczywistych projekcji i uzgodnione okno przełączenia pozostają do wykonania. Raport nie potwierdza kompletności migracji.

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

## Format wejściowy v1

Surowy `legacy-data.json` z `scripts/extract-legacy.py` nie jest obsługiwanym wejściem. Każdy plik musi zawierać `schemaVersion: 1`, `role` oraz wszystkie tablice `categories`, `products`, `customers`, `addresses`, `orders`, `orderItems`; pustą tablicę zapisuj jako `[]`. Baseline i final mają `role: "source"`, target ma `role: "storefront"`. Nieznany klucz, brak wymaganego pola lub inna wersja zatrzymują raport.

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

Przygotowanie eksportu ma być osobnym, przejrzanym działaniem tylko do odczytu. Ten moduł nie zawiera adaptera surowych tabel ani eksportera SQL. Nie można przekazać finalnego źródła jako baseline: baseline musi odtwarzać faktycznie zaimportowany wcześniejszy obraz. Brak tego pliku lub potwierdzonego historycznego mapowania blokuje wiarygodne porównanie.

W [scripts/import-legacy.ts](../scripts/import-legacy.ts) teksty produktów i kategorii pochodzą z języka o `iso_code = pl`; VAT produktu wynika z `tax_rule` dla kraju PL, a grupa `0` oznacza VAT 0. `product.price` jest netto; stock pochodzi z `product.quantity`, kilogramy z `product.weight` zmieniają się na gramy przez `Math.round(Number(weight) * 1000)`. Status uwzględnia archiwum ID 41, 43, 44 oraz `active`. Produkt 16 ma szczególny slug `hps-5w30`. Relacje korzystają z `category_product`, a obraz z inventory i okładki `image.cover = 1`.

Opisy po konwersji muszą używać tej samej sanitacji i zamiany URL jak importer; skrót opisu korzysta z `plainText`. Obraz targetu i opis mogły już zostać świadomie poprawione w CMS, dlatego raport zachowuje je jako edycje targetu do oceny. Kategorie z ID 1, 10, 11 są niewidoczne. Brakujący `id_parent` importer zamienia na null; projekcja musi jawnie odtworzyć tę regułę przed sprawdzeniem referencji. Source powinien otrzymać skuteczne wartości pól, których stary importer nie ustawiał, np. domyślne `saleMode: retail`, a nie dowolnie zgadywane wartości.

[scripts/import-history.ts](../scripts/import-history.ts) mapuje osobno `customer.id_customer`, `address.id_address`, `orders.id_order` i `order_detail.id_order_detail`. E-mail klienta importuje po `trim().toLowerCase()`. JSON adresu zawiera pola w dokładnej postaci budowanej przez funkcję `address`; adres bez klienta trafia do `legacy_records`, a nie do tablicy `addresses` tej projekcji. Zamówienie bez klienta zachowuje null, pozycja bez produktu również. Timestamp `0000-00-00 00:00:00` importer zamienia na null. Dla porównania zastosuj identyczną interpretację `Europe/Warsaw` i canonical ISO UTC po obu stronach; literalny tekst MySQL nie jest równy timestampowi eksportowanemu przez PostgreSQL.

`orders.total_paid` i `total_shipping` importer zmienia na grosze przez `Math.round(Number(value) * 100)` bez dodatkowego VAT, a subtotal wyznacza jako total minus shipping. Netto pozycji `order_detail.product_price` zamienia na jednostkową cenę brutto z `tax_rate`, a dopiero potem mnoży przez `product_quantity`. Historyczny payment label, przewoźnik i śledzenie wymagają hashy skutecznych wartości importera; nie zastępuj ich bieżącą konfiguracją operatora. Przy aktualizacji już istniejącego zamówienia ten importer zmienia wyłącznie `source_data`, a pozycje `ON CONFLICT(legacy_id)` pomija. Wykryta w raporcie zmiana innych pól nie oznacza, że obecny importer potrafi ją bezpiecznie zastosować.

## Jak czytać wynik i wykonać przełączenie

Raport wypisuje nazwę encji, legacy ID, nazwy zmienionych pól, klasyfikację i powody ochrony. Nowy UUID-only wiersz rozpoznaje przez hash UUID. Nie wypisuje adresów, e-maili, treści opisów, kwot ani wartości pól; fingerprinty snapshotów pozwalają przywiązać decyzję do konkretnych projekcji.

`source_only` oznacza zmianę wyłącznie źródła, `target_only` wyłącznie sklepu, `same_change` identyczny wynik obu zmian. `parallel_changes` wskazuje różne pola zmienione po obu stronach, a `conflict` różne nowe wartości wspólnego pola. Osobne klasy obejmują utworzenia, kolizje utworzenia i usunięcia, w tym edytowany w sklepie wiersz usunięty w źródle. Każde usunięcie wymaga sprawdzenia relacji i obowiązków przechowywania; usunięcie źródła nie jest poleceniem skasowania historii.

Nowe zamówienia, aktywne rezerwacje i ruchy magazynowe blokują pełne nadpisanie. Zmiana źródłowego stanu produktu dostaje dodatkowe powody, jeśli target posiada rezerwacje, ruchy lub nowe pozycje zamówień; raport wskazuje też zejście poniżej zarezerwowanej ilości oraz usunięcie produktu nadal powiązanego z pozycją zamówienia. `fullOverwriteAllowed` zawsze wynosi false, a `automaticApplySupported` false, również przy zerowej liczbie różnic.

W uzgodnionym oknie wykonaj backup oraz spójny końcowy snapshot starego sklepu i nowego sklepu. Zapisz ich pochodzenie i SHA-256 w prywatnym protokole. Przygotuj i sprawdź projekcje, wygeneruj raport, następnie rozpatrz każdą zmianę targetu i konflikt. Dopiero osobno przejrzany importer delta z kontrolą wersji/rezerwacji, kopią i testem odtworzenia może wykonać zatwierdzone zmiany. Obecnego `db:import --apply` nie używaj jako zamiennika takiego importera; już teraz blokuje pełny import po pojawieniu się nowych zamówień.

Zakres tego raportu nie obejmuje bajtów mediów, stron CMS, przekierowań, eventów i dodatkowych `legacy_records`, kont auth, konfiguracji operatorów, sesji płatności, przesyłek ani kolejek poczty/analityki. Końcowy protokół migracji musi objąć również te zasoby. Brak różnic w tym module nie jest akceptacją przełączenia domeny.

Testy modułu uruchomisz bez DB: `node --import tsx --test tests/legacy-delta.test.ts`. Sprawdzają syntetyczne scenariusze zmian, finansowe mapowanie, referencje, rezerwacje, brak ujawniania wartości, brak mutacji wejścia i lokalny zapis raportu. Nie potwierdzają rzeczywistego eksportu ani danych klientki.
