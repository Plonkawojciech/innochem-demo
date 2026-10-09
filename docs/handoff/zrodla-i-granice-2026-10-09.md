# Źródła i granice pakietu INNOCHEM

Notatka dla osoby prowadzącej szkolenie i odbiór. Pakiet powstał 09.10.2026 na bazie commitu `e660067b896fdaf78e835dbd51450980d62a8869`. Przy opracowaniu treści odczytano raporty z oryginalnego checkoutu, instrukcje oraz odpowiednie etykiety panelu. Nie wykonano nowego testu aplikacji, logowania klientki, wysyłki, płatności, nadania, zmiany DNS ani kontroli VM.

## Dokumentacja bieżąca i historyczna

Raporty poniżej znajdują się w lokalnym archiwum oryginalnego projektu (`/Users/wojciechplonka/Programo/innochem-demo`), poza śledzonym pakietem. Ścieżki nie są linkami przeznaczonymi dla klientki. Ich SHA-256 i daty odczytu zawiera raport kontroli pakietu; materiałów nie skopiowano ani nie zmieniono.

| Źródło | Co wykorzystano |
| --- | --- |
| `docs/plans/2026-10-08-rano-dla-wojtka.md` | Aktualizację 09.10 o 17:49 CEST, istniejącą listę pięciu czynności i rzeczywiste granice dostępu. Starsze checkpointy pozostają historią. |
| `docs/audit/2026-10-09/independent-qa-fixes/REPORT.md` | Wersję e660067, 314/314 i 181/181, retesty HTTPS, mieszany wynik LCP, flagi podglądu, alarm dysku i otwarte bramki. |
| `docs/audit/2026-10-09/raport-local-qa.md` | Bieżący wynik oraz granice wcześniejszych panel/GA/CLI/wydajności. Nazwa LIVE22 w raporcie oznacza serię na podglądzie HTTPS, a nie otwarcie sprzedaży na innochem.pl. |
| `docs/audit/2026-10-09/current-qa-final/README.md` | Lokalne czynności na fikcyjnej bazie: panel, produkt, kategoria, treści, szkic/publikacja, eksport i wylogowanie. GA używało atrapy; brak dowodu odbioru w Google. |
| `docs/audit/2026-10-09/panel-instruction-final/README.md` | Zakres filmu ok. 87 s: cena, szkic/podgląd CMS, eksport i wylogowanie. Film nie pokazuje publikacji; dane fikcyjne, bez audio. |
| `docs/plans/2026-10-08-umowa-i-odbior.md` | Raport wizualnego odczytu skanu PRG/2026/09/01. JDG jako wykonawca, zakres 12 miesięcy, limit zmian i SEO; rozbieżność CRM oraz brak dowodu wpłaty/podpisu wykonawcy na tej kopii. |
| `docs/start-2026-10-09.md` | Historię planowanego startu opartą na odczytach z 02.10. Nie przejęto go jako aktualnego stanu ani dowodu uruchomienia. Późniejsze bramki mają pierwszeństwo. |
| `docs/audit/2026-10-09/ops-closure-final/README.md` i `ops-recheck-final/README.md` | Dostarczenie alarmu przez providerów oraz datowane odczyty dysku; brak potwierdzenia odczytu przez człowieka. |

Z repo wykorzystano [instrukcję techniczną panelu](../panel-guide.md), [utrzymanie](../operations.md) i [kopie poza VM](../offsite-operations.md), a także etykiety w `app/admin/layout.tsx`, `ProductEditor.tsx`, `SiteEditor.tsx`, `OrderActions.tsx`, `ShipmentActions.tsx` i `eksport/page.tsx`. To kontrola dokumentacji i kodu, nie nowy test flow.

## Zasady wypełniania

Datę startu oraz początek opieki wpisujemy po uruchomieniu domeny docelowej. Stan podglądu i dawne zaproszenia nie potwierdzają bieżących uprawnień kont Anety. P24 wymaga rozstrzygnięcia operatora; pakiet nie zakłada, że sandbox lub inna metoda spełnia brakujący zakres. Dokumentacja operatorów, dostawcy danych i formalne uzgodnienia pozostają do sprawdzenia na właściwych kontach.

Ćwiczenia A-H opisują działania do wykonania. Pola wyników pozostają puste. Nie kopiujemy realnych danych klientki do szkolenia, nie wprowadzamy fikcyjnego wpływu/zwrotu do produkcji i nie traktujemy demonstracyjnego nagrania jako odbioru.

Następne automatyczne kopie nowego skryptu oraz naturalny offsite/ExecStartPost 10.10 o 04:45 wymagają przyszłego dowodu. Dotychczasowa kopia, ograniczony restore i przyjęty alarm nie zamykają tych punktów. Utrzymanie nie ma pełnego wyniku pozytywnego przy otwartym alarmie dysku.

Wysyłka pakietu i wiadomości klientce nie należała do tej pracy. Potwierdzenie jej odpowiedzi, podpisów i finansów pozostaje po stronie uprawnionych osób; pełnych danych klienta, sekretów ani tokenów nie wpisujemy do protokołu.
