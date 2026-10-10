# Regresje niezależnego QA INNOCHEM

Uruchomienie wymaga istniejącego Playwright i systemowego Chrome. Runner nie
uruchamia serwera ani bazy. Używaj lokalnego buildu produkcyjnego lub autoryzowanego
podglądu sklepu; domena klientki jest wykluczona. Katalog wyników musi być nowy.

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
  node tests/browser/independent-qa.mjs \
  http://127.0.0.1:3048 /absolute/path/to/new-results
```

Jeśli Playwright jest już dostępny jako moduł projektu, zmienna nie jest potrzebna.
`CHROME_EXECUTABLE` wskazuje opcjonalnie inną lokalną instalację Chromium.
`EXPECT_BEFORE=1` sprawdza reprodukcję wszystkich czterech rodzin błędów.
`QA_SUPPLEMENT=1` uruchamia wyłącznie dodatkowe kontrole i nie stanowi pełnej bramki.

Regresje obejmują menu mobilne na 360/390/768 px, kontrast karty i popupu w obu
motywach, HTTP 404/noindex i przejście do katalogu oraz całą stopkę na 360/390 px
i w układzie 568×320. Oryginalny rytm B2B jest osobnym przypadkiem: 350 ms po
wcześniejszych Tab, 1750 ms po dojściu do linku „Zostań dystrybutorem”. Test używa
natywnej klawiatury i pięciu punktów trafienia; nie zmienia CSS ani geometrii strony.

Runner blokuje mutujące żądania HTTP i wykonuje wyłącznie lokalne zmiany koszyka
w nietrwałych kontekstach. Wynik AFTER wymaga wszystkich regresji i guardów,
braku błędów strony/prób zapisu oraz zamkniętej własnej przeglądarki.

To kontrola UI w izolowanym headless Chromium. Nie zastępuje fizycznego urządzenia,
rzeczywistego safe-area, pomiarów wydajności ani osobnego dowodu wersji i ustawień
wdrożenia. Pomocnicze eksporty w `mobile-menu.mjs` i `qa-visual-regressions.mjs`
mogą być użyte z przeglądarką zarządzaną przez inny test.

## Fokus linków serii HPS na stronie głównej

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
  CHROME_EXECUTABLE=/usr/bin/chromium \
  node tests/browser/home-focus.mjs \
  https://sklep-innochem.programo.pl /absolute/path/to/new-results EXPECTED_BUILD_ID
```

`EXPECTED_BUILD_ID` pochodzi z osobnego dowodu wdrożenia. Runner sprawdza publiczny
identyfikator buildu przed każdą próbą; nie przypisuje wyniku do SHA bez tego dowodu.
Używa własnych profili headless Chromium oraz czterech szerokości: 320, 412, 900
i 1440 px. Po natywnym przewinięciu przechodzi przez wszystkie siedem linków HPS
w obie strony. Po każdym Tab/Shift+Tab czeka dokładnie trzy klatki, sprawdza
kolejność, trzy punkty trafienia oraz cały outline poniżej rzeczywistego nagłówka.
Nie dodaje CSS, nie czeka na dodatkowe ustabilizowanie scrollu i nie uruchamia
serwera. Wszystkie 56 wyników pozostają w raporcie także przy błędzie widoczności.

Każdy redirect jest osobno kontrolowany; dozwolone są tylko GET/HEAD/OPTIONS
w obrębie localhost albo autoryzowanego podglądu. Obcy origin, próba zapisu, błąd
HTTP/strony/hydracji, błąd zakończenia interceptora lub niepotwierdzone zamknięcie
własnej przeglądarki oznacza FAIL. Tablice błędów są ponownie sprawdzane po
zamknięciu kontekstu i przeglądarki. Kontrole predicate/guard, późnych zdarzeń
i timeoutów cleanup można uruchomić bez przeglądarki:
`node tests/browser/home-focus.mjs --self-test`.

## Pierwsze przełączenie motywu podczas hydracji

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
  CHROME_EXECUTABLE=/usr/bin/chromium \
  node tests/browser/theme-hydration.mjs \
  https://sklep-innochem.programo.pl /absolute/path/to/new-results
```

`PLAYWRIGHT_ROOT` może zamiast `PLAYWRIGHT_MODULE` wskazywać katalog zawierający
moduł `playwright`. `CHROME_PATH` jest alternatywą dla `CHROME_EXECUTABLE`.
Runner korzysta wyłącznie z własnego headless Chromium, nie łączy się z Chrome
użytkownika i nie uruchamia serwera. Wymaga nowego katalogu wyników, autoryzowanego
podglądu albo localhost oraz produkcyjnego buildu Webpack z osobnym chunkiem
`app/layout-*.js`. Brak tego chunku lub przeoczone okno opóźnienia oznacza błąd
testu, nie wynik PASS.

Na stronie głównej i w katalogu runner wstrzymuje tylko GET chunku layoutu przez
5 sekund. Czeka na rejestrację listenerów Reacta przy jeszcze nieaktywnym menu
nagłówka, po czym wykonuje natywny tap. Wymaga dowodu z czasu zdarzenia, że tap
nastąpił w rzeczywistym oknie opóźnienia. Motyw, localStorage i etykieta przycisku
muszą zmienić się od razu i pozostać zgodne po hydracji. Następne tapnięcie,
natywne Enter/Space i tapnięcie w SVG muszą każde przełączyć motyw dokładnie raz.

Profil to 390×844, DPR 1,75, dotyk, 150 ms RTT, 1600/750 kb/s i CPU ×4. Jest to
test zachowania w warunkach opóźnionej hydracji, nie pomiar LCP ani INP. Diagnostyka
zapisuje metadane rejestracji listenerów i zdarzeń, publiczne adresy chunków oraz
zrzuty. Nie zapisuje cookies, kluczy ani danych konta. Wszystkie żądania inne niż
GET/HEAD/OPTIONS i wszystkie obce originy są blokowane; taka próba unieważnia
wynik. PASS wymaga braku błędów strony i hydracji oraz potwierdzonego zamknięcia
obu kontekstów i własnej przeglądarki. Raport nie ustawia arbitralnego SHA:
potwierdzenie wersji wdrożenia trzeba dołączyć osobnym dowodem.
