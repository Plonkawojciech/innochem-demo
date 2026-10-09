# INNOCHEM: regresja checkoutu, 09.10.2026

## Zakres i decyzje

Jedno zadanie: sprawdzić checkout na syntetycznej bazie, utrwalić brakujące przypadki i poprawić wykazane błędy. Punkt wyjścia: `e660067b896fdaf78e835dbd51450980d62a8869`, branch `orchestrator/20261009-innochem_checkout`; stan Git przed pracą był czysty. Oryginalny `innochem-demo` służył do odczytu raportów z 8–9.10, w tym listy `rano-dla-wojtka`.

Nowy `scripts/test-checkout.mjs` uruchamia 17 plików obejmujących zamówienia, koszyk, dostawę, płatności, autoryzację, warunki zakupu, odstąpienia i kolejkę maili. Wymaga jawnego socketu PostgreSQL i bazy `innochem_test_*`; odrzuca `DATABASE_URL`, sprawdza `current_database()` przed zapisem oraz wymaga podglądu z wyłączonymi transportami. Preload `tests/helpers/checkout-network-isolation.mjs` dopuszcza jedynie właściwy socket PG i blokuje pozostałe połączenia TCP oraz `fetch`. Klienci operatorów i SMTP w testach dostają istniejące wewnętrzne atrapy.

Dodałem osiem testów w `tests/checkout-http.test.ts`. Siedem sprawdza rzeczywiste handlery `/api/orders` i `/api/cart` przy użyciu `Request`/`Response`: utworzenie zamówienia i prywatnego cookie, równoległe ponowienia, walkę o ostatnią sztukę, odmowę obcego originu i błędnego body, walidację cen/właściciela/zgód, limit żądań oraz bieżącą dostępność produktów. Ósmy sprawdza blokadę transportów i odmowę błędnej konfiguracji przed uruchomieniem fixture.

## Weryfikacja

**Scoped checkout: ABORTED, brak zaliczonej bramki.** Testy nie mają końcowego podsumowania TAP; nie liczę częściowego wyniku jako dowodu regresji. Typecheck, pełny suite i build: **NOT RUN w tym worktree**, do jednej bramki integracyjnej prowadzącego na świeżej `innochem_test_integrate_*`.

Polecenia i faktyczny wynik:

| Kontrola | Wynik |
| --- | --- |
| `heavy initdb ...`; `heavy pg_ctl ... start` | Utworzenie izolowanego klastra i start zakończone poprawnie. |
| `createdb -h /tmp/innochem-orchestrator-pg -p 55449 -U wojciechplonka innochem_test_checkout_20261009` | Exit 0; odczyt potwierdził nazwę bazy i 0 tabel public przed migracją. |
| `prettier --write scripts/test-checkout.mjs tests/checkout-http.test.ts tests/helpers/checkout-network-isolation.mjs` | Exit 0, trzy pliki sformatowane. |
| `prettier --check package.json scripts/test-checkout.mjs tests/checkout-http.test.ts tests/helpers/checkout-network-isolation.mjs` | Exit 0; finalne cztery pliki zgodne z formatem. Log: `evidence/innochem_checkout/format-final.log` w katalogu sesji. |
| Sesyjny wrapper i lekka kontrola konfiguracji | Exit 0; istniejący local-auth dostępny, `DATABASE_URL` usunięty, właściwy socket, płatności i maile wyłączone. Wartości sekretu nie wypisano. |
| `heavy python3 .../innochem-checkout-verify.py` → `node --import tsx scripts/migrate.ts` | Wszystkie 17 migracji zakończone, exit 0. |
| Ten sam job → `node scripts/test-checkout.mjs` | Przerwany, końcowy exit 143. Brak zaliczonego test suite i brak wyników nowych ośmiu testów. |
| `git diff --check` | Bez błędów przed zamrożeniem kandydata. |

W kolejce `heavy` polecenia małego utworzenia DB i formatowania czekały długo; prowadzący pozwolił wykonać te dwie lekkie operacje bez zajmowania slotu. Anulowałem wyłącznie własne kolejki PID 95940 i 97835 (exit 143), po czym obie komendy przygotowania zakończyły się poprawnie.

Przy anulowaniu kolejnego joba wystąpił wyścig. Odczyt procesu wskazywał `sleep 5`, a poll miał 0 output; zanim wysłałem SIGTERM do wrappera 21005, job uzyskał slot i uruchomił migracje oraz testy. Po pojawieniu się logu migracji zatrzymałem jego własne drzewo 21005/29641/31080/31239/32811, żeby nie pozostawić pracy poza zwolnionym semaforem. PG 93502 nie należał do tego drzewa i pozostał. Prowadzący następnie zlecił zamrożenie kandydata oraz jeden pełny pipeline u siebie; nie uruchamiam dalszego heavy.

Logi zachowałem w `/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/evidence/innochem_checkout/aborted-1/`: `migrations.log`, `checkout-tests.log`, `receipt.json` z rozmiarem i SHA-256 obu kopii. Ten zapis pokazuje próbę przerwaną, nie PASS. Następne anulowanie queued wrappera wymaga najpierw SIGSTOP właściciela, odczytu dzieci i SIGCONT z naturalnym dokończeniem, jeżeli realny krok już wystartował.

## Runtime i pliki

PostgreSQL: PID `93502`, port `55449`, socket `/tmp/innochem-orchestrator-pg`, bez nasłuchu TCP. Dane leżą w `/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/innochem-pg-data`. Baza `innochem_test_checkout_20261009` zawiera jedynie schemat i częściowe syntetyczne fixture. Pustą `innochem_test_checkout_retry_20261009` utworzyłem podczas przygotowania powtórki, przed otrzymaniem polecenia zatrzymania kolejnych jobów; testów na niej nie uruchomiłem. Obie bazy zachowano, bez restore danych klienta.

Sesyjny wrapper `/Volumes/Mad Dog/Archive/codex-work/client-orchestrator-20261009/innochem-runtime.py` przyjmuje nazwę bazy i polecenie. Odczytuje wyłącznie istniejący `programo.innochem.local-auth`, bez wypisywania wartości i tworzenia sekretu; usuwa odziedziczone parametry PG, connection string, SMTP, Stripe, Apaczki i GA4, ustawia bezpieczny runtime oraz wyłącza transporty. Wrapper i logi pozostają poza repo.

Zmiany należą do tego zadania: `scripts/test-checkout.mjs`, `tests/helpers/checkout-network-isolation.mjs`, `tests/checkout-http.test.ts`, alias `npm run test:checkout` w `package.json` i ten raport. Nie zmieniałem logiki produktu, migracji ani wspólnych zależności.

## Granice odbioru

To regresja backendu w izolowanym środowisku; uruchomienie handlerów nie potwierdza renderu przeglądarki, infrastruktury Next ani produkcyjnego HTTPS. Atrapy nie potwierdzają transakcji Stripe, sandboxu Apaczki lub doręczenia SMTP. Rzeczywiste klucze Stripe i dostęp do Apaczki pozostają przy czynnościach Wojtka z istniejącej listy rano; nie wykonywałem logowania, realnego zamówienia, nadania, płatności ani wysyłki.

Nie wykazałem błędu logiki produktu i jej nie zmieniałem. Nie uznaję statycznego przeglądu ani formatowania za dowód działania checkoutu.

## Guard przy pełnym suite

Statyczny przegląd `tests/*.test.ts` i `tests/*.test.mjs` nie znalazł `createServer`/`listen` ani uzasadnionego połączenia TCP. Adresy localhost w testach mediów oznaczają obiekty `Request`; worker ma injected fetch oraz atrapę Docker. Backup/restore korzysta z tego samego socketu PG, także dla pomocniczej bazy `innochem_restore_*`. `health.test.ts` zmienia host na fikcyjny, lecz mockuje każde query i nie otwiera połączenia. Zgodności całego suite z preloadem nie uruchomiłem.

Prowadzący może sprawdzić pełne flat tests przez jawne argumenty Node:

```sh
node --import ./tests/helpers/checkout-network-isolation.mjs --import tsx --test --test-concurrency=1 tests/*.test.ts tests/*.test.mjs
```

Nie ustawiaj guardu globalnie przez `NODE_OPTIONS`: `preflight.test.ts` uruchamia osobny Node z celowo fikcyjnymi `PGHOST=synthetic-db` i `PGDATABASE=synthetic-database`; globalny preload odmówiłby przed kontrolą preflight. Guard nie obejmuje niezależnych procesów Python/CLI; te obecne fixture mają własne atrapy i odziedziczony runtime z wyłączonymi transportami.

Opcjonalny test DB w `legacy-delta-apply.test.ts` pozostaje domyślnie skipped. Przy `INNOCHEM_DELTA_DB_TEST=1` żąda `/tmp/innochem-postgres` oraz 55439, więc nie jest gotowy na nowy socket 55449 bez osobnego dostosowania harnessu. Nie włączałem go ani nie uruchamiałem starego klastra. Guardu nie należy używać dla przeglądarki lub serwera Next, które potrzebują rzeczywistego lokalnego HTTP.

PG pozostaje dla bramki prowadzącego. Odczyt `ps` po zatrzymaniu nie znalazł żadnego z pięciu PID własnego verification tree; kontrola public tables potwierdziła 0 w pustej bazie retry. Bazy i wyniki są zachowane, w tym `evidence/innochem_checkout/status.json` z `acceptedTestCount=0`; serwer Next, Chromium i nowe karty przeglądarki nie powstały. Kolejny krok: static review zamrożonego SHA, następnie świeża baza → `test:checkout` → pełne testy → typecheck → build → format w jednym pipeline prowadzącego, przed push lub deploy.

## Kontynuacja: typ fixture po bramce integracyjnej r2

Root uruchomił r2 na `fc345844c74a026d232d8d8f059728093f504fc1`, z oddzielnymi świeżymi bazami checkout i full oraz 17 migracjami w każdej. Zachowany `ROOT/evidence/integrate_innochem/final-gate-r2/gate.json` potwierdza checkout 116/116 PASS i pełny TAP 312: 311 PASS, 0 FAIL, 1 istniejący legacy SKIP. To wyniki roota dla wcześniejszego SHA, nie testy wykonane ponownie w tym worktree.

Bramka r2 pozostaje **FAILED**: webpack skompilował aplikację w 33,4 s, po czym TypeScript zatrzymał build na `tests/checkout-http.test.ts:215`: `reserved` nie istnieje na wywnioskowanym typie `{ orders: number | null }`. Generyczny domyślny wynik query nie zachował jawnych nazw pól po spreadzie. Minimalna poprawka podaje typ w samym query fixture: `{ stock: number; reserved: number }`, odpowiadający istniejącemu `SELECT stock,reserved`. SQL, runtime, asercje, transporty i skipy pozostają identyczne; bez `any` i castów.

Zmiana powstała na nowej własnej gałęzi `orchestrator/20261009-innochem_checkout-types` od exact r2 SHA. Poprzednia gałąź `orchestrator/20261009-innochem_checkout` zachowuje commit `bff39e9713e1ce7bcee6907146a8496a99ba786b`. Ownership: wyłącznie typ query w `tests/checkout-http.test.ts` oraz ten dopisek raportu. Prywatny helper UI i jego wyniki pozostają poza repo.

Weryfikacja lokalna tej poprawki: parser TypeScript 5.9.3 bez błędów składni, identyczna struktura AST wyemitowanego JavaScript względem r2 oraz `git diff --check`. Tekst emisji różni się formatowaniem tablicy i opcjonalnym końcowym przecinkiem, więc nie raportujemy identycznych bajtów. Pełny typecheck/build/testy dla nowego SHA: **NOT RUN** tutaj, do następnej bramki roota po review i cherry-pick. Nie zaliczamy r2 jako pełnej zielonej bramki i zachowujemy jego logi oraz obie bazy. Kolejny krok roota: świeży checkout/full gate dla końcowego SHA → build → typecheck → format, przed deploy.
