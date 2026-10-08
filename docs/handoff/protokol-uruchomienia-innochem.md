# INNOCHEM — protokół weryfikacji uruchomienia

Dokument do uzupełnienia podczas rzeczywistego uruchomienia i odbioru. Działający podgląd, build ani lokalne testy nie stanowią akceptacji klientki. Nie wpisywać haseł, kluczy, numerów kart ani danych kupujących.

Domena docelowa: innochem.pl. Data uruchomienia: ______. Wersja aplikacji (commit i wdrożenie Coolify): ______. Osoba odbierająca: ______. Data ostatniej synchronizacji danych: ______.

| Obszar | Co należy potwierdzić | Dowód / data / osoba |
| --- | --- | --- |
| Katalog i magazyn | Zgodne stany, ceny brutto, zdjęcia, dokumenty, wagi i rzeczywiste parametry paczek. Produkty przemysłowe obsługiwane jako zapytania. | |
| Telefon i komputer | Dodanie właściwej ilości, komunikat z przejściem do koszyka, menu, galeria, formularze, przewijanie i fokus; jasny i ciemny motyw. Osobno Safari/iPhone i Android. | |
| Dostawa i pobranie | Zatwierdzone przez właścicielkę progi, dopłaty, limit COD i przypadki dwóch paczek. Wyliczenie przy rzeczywistych wagach i kartonach. | |
| Płatności | Właściwe konto INNOCHEM, sandbox, webhook, sukces/anulowanie/timeout, brak podwójnego zamówienia, refundacja i kontrolowany test produkcyjny. Status P24 potwierdzony przez operatora; nie zakładać dostępności metody na podstawie kodu. | |
| Apaczka | Dostęp właściciela, właściwe usługi, wycena, test sandbox oraz uzgodnione kontrolne nadanie, etykieta i tracking. | |
| Poczta | Konto i domena Resend, właściwy nadawca/reply-to, pojemność współdzielonego planu. Potwierdzony odbiór każdego aktualnego flow: zamówienie, konto/reset, zapytanie i zwrot. AUTH SMTP i stare logi nie zastępują odbioru. Istniejące skrzynki Outlook pozostają czynne. | |
| GA4 i Search Console | Delegowane właściwe usługi klientki, finalna domena, sitemap, odmowa/wycofanie zgody, prawidłowe zdarzenia zakupu bez danych osobowych i bez duplikatów. | |
| Dokumenty | Rzeczywiste warunki handlowe, brak markerów roboczych, zatwierdzenie Anety i publikacja właściwej wersji. Zakres dostawców danych zgodny z uzgodnionymi dokumentami. | |
| Przełączenie | Ustalone okno, snapshot starego sklepu i kontrolowana delta, HTTPS, www/apex, linki auth i operatorów, właściwy origin; gotowy rollback. | |
| Utrzymanie | Zdrowe automatyczne cykle workera i monitora po wydaniu; doręczony alarm testowy, następna automatyczna kopia, trwała szyfrowana kopia poza VM i udokumentowane odtworzenie. | |
| Panel i odbiór | Login istniejącym kontem, samodzielna obsługa przez Anetę: produkt/stan, zamówienie, płatność/nadanie, treści i eksport. Data szkolenia, materiały i odpowiedź klientki. | |
| Opieka | Początek oraz koniec uzgodnionego okresu, kanał zgłoszeń, limit zmian i pierwszy termin raportu SEO/artykułu. Rozbieżności umowa–CRM wyjaśnione przed zmianą rozliczeń. | |

Instrukcja: [Obsługa panelu](instrukcja-panelu-innochem.md). Raport opieki: [Szablon miesięcznego raportu SEO](szablon-raportu-seo-innochem.md).

Lokalne pomiary Lighthouse i web-vitals służą do diagnozy. Wyniki na domenie docelowej oraz dane rzeczywistych użytkowników należy zapisać osobno. Szkolenie, wysyłka dokumentów i odbiór wymagają rzeczywistego wykonania; ten szablon nie potwierdza żadnej z tych czynności.
