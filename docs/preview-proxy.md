# Kompresja i Vary na podglądzie INNOCHEM

Kontrakt dotyczy wyłącznie aplikacji Coolify `oxdsv73fkwbxg7t0umly3ucd` i HTTPS `sklep-innochem.programo.pl`. Nie zmienia wspólnego middleware, routera HTTP, innych aplikacji ani ustawień operatorów.

Next.js ma `compress: false`. Origin nie kompresuje ponownie odpowiedzi; własny middleware proxy negocjuje Brotli, gzip i zstd. W Next.js 16.3.8 renderer App Router zastępuje nagłówek Vary z `next.config.mjs`, więc sama globalna reguła w aplikacji nie zapewnia `Accept-Encoding` dla dokumentów identity i q=0.

Własny middleware odpowiedzi ustawia konserwatywny zestaw wszystkich obecnych wymiarów:

```text
Accept-Encoding,Accept,RSC,Next-Router-State-Tree,Next-Router-Prefetch,Next-Router-Segment-Prefetch,Next-Url
```

`Accept` jest wymagane przez obrazy Next i trasę `app/media/[...path]/route.ts`. Pola RSC oraz warunkowe `Next-Url` pochodzą z App Router. W bieżącej wersji nie znaleziono dodatkowego wymiaru ani `Vary: *`. Stała wartość zachowuje te wymiary, kosztem dodatkowych wariantów cache; nie zmienia `Cache-Control`, cookies, MIME ani treści odpowiedzi. To kontrakt tej wersji aplikacji, a nie ogólne dopisywanie do dowolnego nagłówka. Zmiana pól Vary w kodzie lub aktualizacja Next wymaga ponownego sprawdzenia zestawu.

Zmiana konfiguracji obejmuje dokładnie dwie etykiety:

```text
traefik.http.routers.https-0-oxdsv73fkwbxg7t0umly3ucd.middlewares=innochem-preview-oxdsv73fkwbxg7t0umly3ucd-vary@docker,innochem-preview-oxdsv73fkwbxg7t0umly3ucd-brotli@docker
traefik.http.middlewares.innochem-preview-oxdsv73fkwbxg7t0umly3ucd-vary.headers.customresponseheaders.Vary=Accept-Encoding,Accept,RSC,Next-Router-State-Tree,Next-Router-Prefetch,Next-Router-Segment-Prefetch,Next-Url
```

Pozostałe etykiety Brotli i wszystkie inne etykiety pozostają identyczne. Pełne pole konfiguracji zachowuje się wyłącznie w RAM procesu wdrożenia; do raportów trafiają hashe i liczba zmian. Odwrotna transformacja usuwa wyłącznie własny nagłówek i przywraca poprzedni łańcuch middleware, z kontrolą identyczności bajtów.

Po wdrożeniu wymagany jest rzeczywisty odbiór GET i HEAD dla HTML, CSS, JS i fontów: br/gzip/identity, q=0, niezmienione rozkodowane zasoby, pełny zestaw Vary, security/cache, HEAD/304/Range i brakujący zasób. Pola RSC i Accept muszą pozostać obecne. Potem wykonuje się zimne serie Lighthouse oraz natywne interakcje na tym samym CID i commitcie. Sam zapis etykiet ani build nie zalicza tego odbioru.

[Dokumentacja Traefik: własne nagłówki zastępują istniejące](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/headers/).
