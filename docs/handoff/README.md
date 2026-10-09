# Przekazanie sklepu INNOCHEM

Pakiet do przeglądu i rzeczywistego szkolenia. Nie potwierdza wysyłki, uruchomienia domeny, czynności operatorów ani odbioru klientki.

| Materiał | Zastosowanie |
| --- | --- |
| [Szkolenie i odbiór - Markdown](innochem-szkolenie-i-odbior-2026-10-09.md) | Samodzielne ćwiczenia, lista bramek, utrzymanie i pola na decyzję odbiorczą. |
| [Szkolenie i odbiór - PDF](innochem-szkolenie-i-odbior-2026-10-09.pdf) | Ta sama treść do wspólnego przejścia lub wydruku. |
| [Obsługa panelu](instrukcja-panelu-innochem.md) | Codzienna obsługa produktu, zamówienia, przesyłki, zwrotów i treści. |
| [Protokół uruchomienia](protokol-uruchomienia-innochem.md) | Daty, osoby i dowody całego wydania na domenie docelowej. |
| [Szablon raportu utrzymania i SEO](szablon-raportu-seo-innochem.md) | Raport po rzeczywistym starcie, bez fikcyjnych wyników. |
| [Źródła i granice](zrodla-i-granice-2026-10-09.md) | Notatka dla prowadzącego; oddziela wcześniejsze dowody od tej pracy nad dokumentacją. |

Film demonstracyjny panelu jest osobnym materiałem z lokalnego archiwum projektu; pakiet MD/PDF go nie zawiera. Prowadzący wpisuje sposób rzeczywistego przekazania filmu i pozostałych materiałów w zapisie szkolenia.

PDF powstaje z Markdown przez `python3 docs/handoff/render-handoff.py`. Wymaga ReportLab, fontów Arial i Popplera (`pdftoppm`); można przekazać katalog fontów przez `--font-dir`. Polecenie renderuje wszystkie strony do lokalnego `.pdf-qa/`, poza Git. `--skip-page-render` ogranicza je do PDF. W tej sesji polecenia renderowania i kontroli wykonano przez globalny wrapper `heavy`. Szczegóły sprawdzenia końcowego są w [raporcie kontroli pakietu](kontrola-pakietu-2026-10-09.json).
