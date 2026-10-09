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
