# Analityka i bezpieczne źródło wejścia

`lib/analytics.ts` uruchamia GA4 dopiero po aktualnej zgodzie z cookie i przy
ustawionym `NEXT_PUBLIC_GA4_MEASUREMENT_ID`. Odmowa oraz brak identyfikatora
nie tworzą iframe ani skryptu Google. Wycofanie niszczy runtime i czyści kolejkę;
identyfikatory zakupów pozostają objęte istniejącą zgodą serwerową.

Na publicznych stronach `page_location` zachowuje wyłącznie `utm_source`,
`utm_medium`, `utm_campaign`, `utm_content` i `utm_term`. Wartość zaczyna się
literą ASCII, ma 1–64 znaki i zawiera tylko litery ASCII, cyfry, `_` lub `-`.
Przykład: `?utm_source=newsletter&utm_medium=email&utm_campaign=autumn_2026`.
To format nazw kampanii; osoby przygotowujące linki nie powinny wpisywać do
tych nazw danych klientów. Walidacja składni nie potrafi rozpoznać imienia
w zwykłym słowie.

Kod pomija duplikaty danego klucza, nadmiernie długi query, UUID i długie ciągi
hex/cyfr, słowa oznaczające tokeny oraz wartości z emailami, spacjami,
znakami sterującymi, Unicode lub kodowaniem pozostawiającym `%`.
Nie przekazuje dowolnego query, `gclid`, zapytań wyszukiwarki ani fragmentu URL.
Na `/konto`, `/zamowienie` i `/admin` nie zachowuje żadnego UTM. Maskuje prywatne
ścieżki także przy zakodowanym prefiksie; panel nie wysyła zdarzeń.

Pierwsze `document.referrer` przekazuje wyłącznie origin zewnętrznego źródła
HTTP(S), bez loginu, hasła, ścieżki, query czy fragmentu. Wewnętrzny referrer
pierwszego dokumentu zostaje pusty. Przy przejściu SPA referrer zawiera origin
sklepu oraz poprzednią zamaskowaną ścieżkę, bez jej parametrów. `track` ponownie
filtruje referrer przekazany przez komponent; `params` nie nadpisze sanitacji
`page_location` ani tytułu konta lub zamówienia.

`AnalyticsVisits` korzysta z `usePathname` i `useSearchParams`, żeby zauważyć
także nawigację przy tym samym pathname. Własny `Suspense` z `fallback={null}`
obejmuje wyłącznie niewidoczny komponent statystyki. Treść sklepu pozostaje poza
tą granicą. Powtórne wykonanie efektu nie dubluje widoku tego samego URL;
zmiana query po nawigacji generuje widok z ponownie oczyszczonym adresem.
Automatyczne `send_page_view` Google pozostaje wyłączone.

Runtime działa w pustym, usuwalnym iframe z `referrerPolicy="no-referrer"`.
Pusty `about:blank` nadal dziedziczy referrer rodzica. Przed załadowaniem tagu
kod ustawia więc własne niezmienne `document.referrer` na pusty ciąg oraz
publiczny bazowy URL dokumentu na origin sklepu. Dotyczy to zwykłych odczytów
obserwatorów; nie tworzy granicy bezpieczeństwa dla skryptu same-origin.
Google nie dostaje DOM formularzy ani historii routera przez automatyczne
obserwatory dokumentu iframe; config i zdarzenia zawsze mają jawne oczyszczone
adresy. Iframe ma ten sam origin, aby zachować istniejące cookies i przypisanie
zakupów do sesji. **Nie jest sandboxem bezpieczeństwa przed złośliwym skryptem**:
kod same-origin mógłby celowo odczytać `parent`. Zmiana tej granicy wymagałaby
osobnej architektury przekazywania identyfikatorów i odbioru zakupów.

Testy syntetyczne: `node --import tsx --test tests/consent.test.ts
tests/analytics-attribution.test.ts`. Obejmują allowlistę, złośliwe wartości,
referrery, zakodowane ścieżki prywatne, ochronę przed nadpisaniem URL i brak
runtime bez zgody oraz po wycofaniu. Nie dowodzą przyjęcia zdarzeń przez GA4.
Pełny odbiór nadal wymaga przechwycenia żądań przeglądarki w kontrolowanym
sandboxie i zdarzeń u właściwego odbiorcy Google po dostępie do usługi klientki.

Źródła: [konfiguracja pól GA4](https://developers.google.com/analytics/devguides/collection/ga4/reference/config),
[polityka same-origin](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy),
[iframe i sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe).
