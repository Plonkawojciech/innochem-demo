# Paczka 2: wynik implementacji

Stan: kod przygotowany na `feat/innochem-store`, bez commita i wdrożenia.
Pełny odbiór wymaga sesji z dostępem do lokalnego Postgresa i macOS Keychain.

## Zmienione pliki

| Obszar                 | Pliki                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zgoda i ładowanie GA4  | `lib/consent.ts`, `lib/analytics.ts`, `components/ConsentBanner.tsx`, `components/Analytics.tsx`, `app/api/analytics/consent/route.ts`                                                            |
| Wygląd i stopka        | `app/layout.tsx`, `components/SiteChrome.tsx`, `app/globals.css`                                                                                                                                  |
| Zdarzenia sklepu       | `components/ProductCard.tsx`, `components/InquiryForm.tsx`, `lib/cart.tsx`, `app/katalog/page.tsx`, `app/kategoria/[slug]/page.tsx`, `app/produkt/[id]/BuyBox.tsx`, `app/zamowienie/Checkout.tsx` |
| Zamówienia i worker    | `lib/server/analytics.ts`, `lib/server/orders.ts`, `lib/server/admin-orders.ts`, `lib/server/worker.ts`, `app/api/orders/route.ts`                                                                |
| Baza                   | `db/migrations/014_analytics.sql`                                                                                                                                                                 |
| Panel tylko do odczytu | `app/admin/analityka/page.tsx`, `app/admin/layout.tsx`                                                                                                                                            |
| Testy                  | `tests/analytics.test.ts`, `tests/consent.test.ts`, `tests/stripe.test.ts`                                                                                                                        |
| Dokumentacja           | `docs/legal-drafts.md`, ten raport; lokalny plan w ignorowanym `docs/plans/2026-09-29-analytics-implementation.md`                                                                                |

Istniejący nieśledzony katalog `docs/research/` pozostawiony bez zmian.
Stripe nadal wywołuje istniejące `markOrderPaidInTransaction`; wpis `purchase`
powstaje we wspólnym zatwierdzeniu płatności, więc nie potrzeba drugiego wywołania
w `stripe-payments.ts`.

## Migracja i konfiguracja

Migracja tworzy `analytics_outbox`, indeks kolejki i unikalność
`(order_id, event_type, destination)`. Dodaje identyfikatory GA i czas zgody do
`orders`. Tabela `analytics_consents` oraz powiązanie w zamówieniu pozwalają
sprawdzić i wycofać zgodę przed wysyłką. `next_attempt_at` steruje ponowieniami.
Migracja nie została uruchomiona w istniejącej bazie.

Nowe zmienne:

- `NEXT_PUBLIC_GA4_MEASUREMENT_ID`: publiczny identyfikator strumienia; pusta
  wartość wyłącza baner opcjonalnych zgód i tag. Zmiana wymaga nowego builda.
- `GA4_API_SECRET`: sekret Measurement Protocol, wyłącznie na serwerze.

Pozostaje istniejący przełącznik `STORE_WORKER_ENABLED` i autoryzacja workera.
Nie dodano wartości do plików środowiskowych ani nie odczytywano `.env*`.

## Weryfikacja

- `npm run typecheck`: zaliczone.
- `npm run format:check`: zaliczone.
- `node --import tsx --test tests/consent.test.ts`: 5/5 zaliczone. Są to testy
  jednostkowe, w tym kontrolowane atrapy środowiska przeglądarki, nie test live Google.
- `git diff --check`: zaliczone; `docs/legal/` bez zmian.
- `python3 scripts/test-local.py`: zablokowane przed utworzeniem świeżej bazy;
  sandbox odrzuca połączenie z `/tmp/innochem-postgres/.s.PGSQL.55439` komunikatem
  `Operation not permitted`. Testy integracyjne outboxa pozostają niewykonane.
- `python3 scripts/local.py npx next dev -p 3048`: skrypt zatrzymany na odmowie
  dostępu do Keychain. Serwer nie wystartował. Kontrola curl w obu wariantach
  `NEXT_PUBLIC_GA4_MEASUREMENT_ID` i kontrola w przeglądarce pozostają niewykonane.

Nie uruchomiono builda produkcyjnego. Nie ma potwierdzenia przyjęcia zdarzeń przez GA4.
Nie pozostał uruchomiony serwer dev ani własny proces pomocniczy.

## Po odblokowaniu środowiska

Uruchomić `python3 scripts/test-local.py`, a następnie wskazany serwer na porcie 3048. Sprawdzić HTML dla pustego ID oraz `G-TEST123`, klawiaturę i wygląd mobilny,
brak żądań Google przed zgodą, przejścia SPA, odmowę i wycofanie. Testy HTTP workera
korzystają wyłącznie z wstrzykniętego `fetch`, bez wysyłki do Google.

Przed rzeczywistym włączeniem uzgodnić polityki, skonfigurować usługę testową GA4,
wyłączyć pomiar automatyczny historii i funkcje reklamowe oraz sprawdzić odbiór
zdarzeń. [Dokumentacja MP](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference)
wyjaśnia, że odpowiedź 2xx nie potwierdza poprawnego przetworzenia zdarzenia.

Nie zmieniono polityk HTML, ustawień konta Google, danych istniejącej bazy ani
konfiguracji podglądu. Nie wykonano commita, pusha ani deploya.
