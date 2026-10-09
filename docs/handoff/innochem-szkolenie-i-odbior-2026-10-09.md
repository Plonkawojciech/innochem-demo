# INNOCHEM: szkolenie i odbiór sklepu

Materiał do wspólnego przejścia z Anetą Zalewską. Wersja z 09.10.2026, na podstawie raportów do 17:49 CEST. Dokument nie potwierdza uruchomienia innochem.pl, odbycia szkolenia, wysłania materiałów ani akceptacji klientki. Wyniki ćwiczeń i decyzję odbiorczą wpisujemy po ich wykonaniu.

## 1. Punkt wyjścia

Ostatni opisany podgląd ma wersję `e660067`. Raport tej wersji potwierdza 314/314 testów oraz 181/181 asercji przeglądarkowych lokalnie i na HTTPS. To dowód techniczny w zapisanym zakresie, bez zamówień, płatności i nadań produkcyjnych. W tym opracowaniu nie wykonano ponownej kontroli usług live.

| Potwierdzone w raportach | Co pozostaje do wykonania |
| --- | --- |
| Fikcyjna baza: logowanie, 24 widoki panelu, produkt/zdjęcie, kategoria, CMS, cztery eksporty i wylogowanie. | Uprawnienia istniejącego konta Anety oraz samodzielne ćwiczenie klientki. |
| Podgląd: menu, kontrast, polski 404 i fokus. Natywny dotyk: 16/16 flow, maks. INP 72 ms. | Safari na fizycznym iPhonie, fizyczny Android i domena docelowa. |
| Laboratorium po wdrożeniu: po 5/6 prób home i katalogu z LCP poniżej 2,5 s. | Cel w każdej próbie niezaliczony: najgorsze LCP 2,729 s / 2,539 s. Brak danych CrUX. |
| Worker i HTTPS działają; istniejąca kopia przechodzi kontrolę. | Alarm dysku 93,2% pozostaje otwarty. Następne naturalne wykonania nowych kopii wymagają dowodu. |

Płatności i dostarczanie maili sklepu pozostają wyłączone w tym datowanym podglądzie. Potwierdzony status domeny Resend oraz dostarczenie alarmu utrzymania nie potwierdzają doręczenia wiadomości zakupowych.

### Dostęp i przygotowanie szkolenia

Panel podglądu: https://sklep-innochem.programo.pl/admin. Bez sesji prowadzi do `/konto?returnTo=admin`; po logowaniu istniejącym kontem obsługi wraca do panelu. Zwykłe konto kupującego nie daje uprawnień administratora. Po potwierdzonym przełączeniu wejście będzie pod https://innochem.pl/admin.

Prowadzący zapisuje adres i tryb środowiska oraz wyznacza fikcyjny produkt, stronę i zamówienia. Podgląd zawiera zaimportowane dane; zapisy szkoleniowe wykonujemy w uzgodnionym, odizolowanym środowisku z fikcyjnymi rekordami. Poczta, płatności i realne nadania pozostają tam wyłączone, chyba że trwa osobno uzgodniony test sandbox.

Codzienne czynności opisuje [Obsługa panelu](instrukcja-panelu-innochem.md). Osobny film demonstracyjny trwa ok. 87 s, bez audio, z fikcyjnymi danymi. Pokazuje cenę, szkic/podgląd CMS, eksport CSV i wylogowanie; nie pokazuje publikacji ani nie zastępuje ćwiczenia Anety. Film nie jest załącznikiem PDF.

<!-- pdf-pagebreak -->

## 2. Ćwiczenia: produkt, treść i eksport

Aneta wykonuje czynności samodzielnie, a prowadzący zapisuje wynik: OK, problem albo nie wykonano. Samo obejrzenie pokazu nie zamyka ćwiczenia. Wpisujemy identyfikator fikcyjnego rekordu, datę oraz obserwowany rezultat; bez haseł i danych klientów.

### A. Produkt i magazyn

W „Produktach” otwórz wyznaczoną pozycję. Zapisz jej cenę i stan wyjściowy, zmień cenę brutto na uzgodnioną wartość testową oraz popraw krótki fragment opisu. Wybierz fikcyjne zdjęcie z biblioteki lub wgraj je, ustaw podpis i kolejność galerii. Kliknij „Zapisz produkt”, potem „Podgląd produktu”.

Sprawdź na karcie widoczną cenę, opis i obraz. Pierwszy obraz jest okładką; odpięcie go od produktu nie usuwa oryginału z biblioteki. Przywróć wartości testowe z początku ćwiczenia i potwierdź publiczny efekt. Jeśli panel wykryje równoległą zmianę, odśwież dane przed kolejnym zapisem. Nie obniżaj stanu poniżej rezerwacji.

Wynik A / rekord / data: ___________________________________________

### B. Szkic i publikacja witryny

W „Wygląd i treści witryny” zmień uzgodniony tekst testowy. Kliknij „Zapisz szkic”, następnie „Podgląd szkicu”. Sprawdź telefon i komputer; zakończ podgląd. Szkic nie zmienia opublikowanej treści i widzi go tylko administrator.

Prowadzący potwierdza, że publikacja dotyczy wyłącznie środowiska szkoleniowego. Wtedy użyj widocznego przycisku „Publikuj” lub „Publikuj w podglądzie sklepu”, przejdź przez potwierdzenie i sprawdź efekt poza podglądem szkicu. Z historii wczytaj wcześniejszą wersję jako szkic, obejrzyj ją, a następnie opublikuj, żeby przywrócić treść wyjściową.

Wynik B / wersje treści / data: ______________________________________

### C. Strona informacyjna i zapytanie

W „Treściach” edytuj fikcyjną stronę informacyjną; zapisz i sprawdź jej adres. Dokumenty prawne pomijamy w ćwiczeniu zapisu, ponieważ ich zmiana wymaga ponownego zatwierdzenia warunków sprzedaży. W „Zapytaniach” odczytaj fikcyjne zgłoszenie i dopisz notatkę wewnętrzną. Notatka nie wysyła odpowiedzi klientowi.

Wynik C / strona i zgłoszenie / data: _________________________________

### D. Eksport i wylogowanie

W „Eksporcie” pobierz „Produkty - CSV” i sprawdź cenę wyznaczonego produktu. Następnie, tylko w fikcyjnej bazie, pobierz JSON, CSV zamówień i archiwum plików. Sprawdź, czy pliki otwierają się i zawierają właściwe rekordy. Zdjęcia są w osobnym archiwum; JSON zawiera ich manifest. Eksport nie zawiera haseł ani sesji i nie zastępuje kopii technicznej.

Wyloguj się; ponowne wejście do panelu ma prowadzić do logowania. Eksporty z rzeczywistego sklepu zawierają dane osobowe, więc przechowuj je prywatnie i udostępniaj tylko uprawnionemu odbiorcy.

Wynik D / pliki / wylogowanie / data: _________________________________

<!-- pdf-pagebreak -->

## 3. Ćwiczenia: zamówienie i rozliczenia

Poniższe zadania wykorzystują osobne fikcyjne zamówienia. Test sklepu bez operatora sprawdza zapis i historię, ale nie dowodzi przepływu pieniędzy, nadania lub doręczenia maila. Po zaliczeniu ćwiczeń trzeba wykonać odrębne bramki operatorów i produkcji z następnej strony.

| Zadanie | Czynność i oczekiwany wynik |
| --- | --- |
| E. Zakup bez konta i anulowanie | Na fikcyjnym produkcie przejdź przez koszyk, dostawę, zgody i złożenie zamówienia. Sprawdź numer, pozycje, sumę, status oraz rezerwację. Anuluj odrębne nieopłacone zamówienie i potwierdź zwolnienie jego rezerwacji. |
| F. Przelew, online i pobranie | Odczytaj właściwe akcje zamówienia. „Potwierdź zaksięgowany przelew” wymaga faktycznego wpływu i potwierdzenia; nie zapisuj fikcyjnej wpłaty w prawdziwym sklepie. Płatność online potwierdza operator, nie sam powrót do sklepu. Pobranie nie oznacza wpływu przez Stripe. |
| G. Dostawa | Porównaj kuriera i odbiór osobisty. Odbiór w Kielcach wymaga ustalenia terminu, bez nadawania paczki. Dla kuriera w sandboxie wpisz rzeczywiste parametry wyznaczonych opakowań, uzyskaj wycenę i sprawdź usługę, odbiorcę oraz wszystkie paczki. |
| H. Odstąpienie i zwrot | Na osobnym fikcyjnym zamówieniu złóż oświadczenie przez formularz. W „Odstąpieniach” odczytaj oryginalną treść, zmień status i notatkę. Treść oświadczenia ma pozostać bez zmian. Omów osobne rozliczenie pieniędzy i przyjęcie towaru. |

Wyniki E / F / G / H, numery fikcyjnych zamówień i data:

_________________________________________________________________

### Nadanie i wynik niejednoznaczny

Przed „Nadaj przez Apaczkę” kliknij „Sprawdź koszt nadania”. Wycena obowiązuje pięć minut; zmiana usługi, paczek, daty albo danych zamówienia wymaga nowej wyceny. Potwierdzenie obejmuje wszystkie paczki. Koszt operatora nie zmienia wcześniej ustalonej ceny zamówienia, a pobranie dotyczy całego zlecenia.

Sandbox nie zamawia realnego kuriera. Test live wymaga osobnego uzgodnienia i konfiguracji produkcyjnej. Po przyjęciu nadania pobranie etykiety może dopiero uzupełnić numer listu. Brak numeru, timeout lub niejasne anulowanie wymagają sprawdzenia w Apaczce i u administratora; nie ponawiaj operacji. Anulowanie przesyłki nie anuluje zamówienia ani płatności. Status „wysłane” wpisz po przekazaniu paczki.

### Pieniądze i sztuki wracają osobno

Zwrot pieniędzy wykonuje uprawniona osoba w banku lub u operatora. Dopiero potem „Zapisz wykonany zwrot pieniędzy” zapisuje kwotę, dowód, pozycje i uzasadnienie; przycisk nie wysyła pieniędzy. Korekta samej kwoty ma ilość 0. „Przyjmij zwrócone sztuki do magazynu” dotyczy faktycznie otrzymanego towaru nadającego się do sprzedaży i wymaga osobnego dowodu. Nie zapisuj drugi raz tych samych sztuk.

Zamówienie po refundacji albo przyjęciu zwrotu wymaga ustalenia dalszej wysyłki. Po niejasnym zapisie odśwież historię. Płatność, która nadejdzie po anulowaniu, wymaga wyjaśnienia zamiast automatycznej realizacji pierwotnego koszyka.

<!-- pdf-pagebreak -->

## 4. Lista odbioru i bramki uruchomienia

Każdy wiersz ma status OTWARTE, dopóki osoba odpowiedzialna nie wpisze daty i dowodu. Test techniczny, sandbox i live otrzymują osobne wpisy. Pominięty zakres wymaga uzgodnienia z klientką; czynność jednej strony nie zastępuje akceptacji drugiej.

| Bramka / odpowiedzialność | Wymagany dowód zamknięcia |
| --- | --- |
| Konto i szkolenie / Aneta + prowadzący | Uprawnienia istniejącego konta, samodzielne ćwiczenia A-H, wynik na telefonie i komputerze oraz odpowiedź klientki. |
| Katalog i pakowanie / Aneta | Aktualne ceny, stany, zdjęcia i dokumenty; rzeczywiste wagi i parametry wszystkich paczek. Wyjaśnione etykiety oraz towary archiwalne. |
| Dostawa i warunki / Aneta + Wojtek | Uzgodnione stawki, próg darmowej dostawy, zakres progu sztuk, wielopaczkowość, COD i limit. Opublikowane dokumenty bez markerów roboczych, zatwierdzona wersja warunków. |
| Stripe sandbox / techniczny + operator | Właściwe konto INNOCHEM, klucze testowe i webhook; sukces, anulowanie, timeout i brak podwójnego zamówienia. P24 wymaga decyzji Stripe; aktywny BLIK nie zamyka tej pozycji. |
| Stripe live / uprawniony właściciel | Osobno uzgodniona rzeczywista płatność, potwierdzony webhook i zwrot; dostępne metody zgodne z decyzją operatora i uzgodnionym zakresem. |
| Apaczka / właściciel + techniczny | Właściwe konto, aktywne API, sandbox i usługi; osobno uzgodnione nadanie live, etykieta oraz numer listu. Bez ponawiania niejasnego zlecenia. |
| Poczta / Wojtek + Aneta | Bieżący odbiór: zamówienie, płatność, wysyłka, konto/reset, zapytanie i odstąpienie; prawidłowy nadawca i odbiorcy. Sprawdzony Outlook po zmianie domeny. |
| Dane i domena / Wojtek + techniczny | Uzgodnione okno, finalny snapshot starego sklepu i kontrolowana delta. innochem.pl, HTTPS, www, przekierowania, linki logowania i operatorów; gotowy rollback. |
| Urządzenia i szybkość / prowadzący + klientka | Fizyczny Safari/iPhone i Android; zapisane wszystkie próby LCP/INP, także gorsze. Osobno laboratorium i dane użytkowników. |
| Google i dostawcy danych / właścicielka + Wojtek | Dostępy do usług klientki, finalna domena, sitemap, odmowa/wycofanie zgody i odbiór zdarzeń bez PII/duplikatów. Uzgodniony zakres Resend/Google oraz dokumenty. |
| Utrzymanie / Wojtek | Naturalne cykle workera/monitora, następna kopia lokalna oraz offsite po nowym wdrożeniu, kontrola odzyskania. Wyjaśniony alarm dysku; odbiorca alarmów potwierdza ich zauważenie. |
| Formalny odbiór i opieka / obie strony | Aktualna umowa i ewentualny aneks, rozliczenia i podpisy wyjaśnione. Rzeczywista data startu, zakres odbioru, zastrzeżenia, termin poprawek i odpowiedź stron. |

Pełny zapis dowodów prowadzi [Protokół weryfikacji uruchomienia](protokol-uruchomienia-innochem.md). Nie wpisujemy 09.10 jako daty startu tylko dlatego, że pojawiła się w planie. Opieka zaczyna się od rzeczywistego uruchomienia na domenie docelowej.

<!-- pdf-pagebreak -->

## 5. Utrzymanie i zgłoszenia

Przeczytany 08.10 skan umowy PRG/2026/09/01 wskazuje 12 miesięcy opieki od uruchomienia na domenie docelowej. Obejmuje hosting, SSL, codzienne kopie przez 30 dni, monitoring, bezpieczeństwo, zgłoszenia w dni robocze i do pięciu godzin zmian miesięcznie. Zakres SEO obejmuje miesięczny raport oraz jeden uzgodniony artykuł ok. 800-1200 słów; umowa nie gwarantuje pozycji ani sprzedaży.

Stroną wykonawczą skanu jest Wojciech Płonka (JDG). Opis rat w CRM różni się od skanu; wpłata, ewentualny aneks i kopia z podpisem wykonawcy wymagają potwierdzenia. Ten materiał nie zmienia strony umowy, kwot ani rozliczeń. Nie ustala dodatkowego czasu reakcji, którego nie potwierdzono.

### Co wykonuje obsługa, a co prowadzący techniczny

Aneta pilnuje zamówień, rzeczywistych wpływów, stanów, paczek i zgłoszeń klientów. Osoba techniczna obsługuje integracje, wydania, kopie, alarmy oraz wynik niejednoznaczny u dostawcy. Sekrety nie trafiają do instrukcji, maila zgłoszeniowego ani treści CMS.

Worker ma harmonogram minutowy, monitor co pięć minut. Kopia lokalna jest zaplanowana na 03:15, istniejący Storage Box/restic na 04:45 Europe/Warsaw. Kontrola ograniczonego odzyskania offsite sprawdziła dump i próbkę mediów; nie jest pełnym uruchomieniem odtworzonej aplikacji. Nowe naturalne cykle po zmianie skryptów pozostają do odbioru. Sam plik kopii albo zdrowy HTTPS nie potwierdza całego utrzymania.

Alarmy wykorzystują istniejący mail Wojtka i ntfy Programo. Raporty potwierdzają przyjęcie alarmów przez dostawców, bez dowodu przeczytania lub wyświetlenia na telefonie. Alarm dysku z ostatniego checkpointu pozostaje otwarty. Porządki, usuwanie danych i odtworzenie istniejącej bazy wymagają odrębnej decyzji; powrót do starego kodu nie może zgubić nowych zamówień.

### Jak zgłosić problem

Przekaż prowadzącemu numer zamówienia lub nazwę strony, czas wystąpienia, urządzenie, widoczny komunikat i wykonaną czynność. Dodaj informację, czy klient zapłacił, paczka rzeczywiście wyszła i czy operację już ponowiono. Zrzut ogranicz do potrzebnego fragmentu bez haseł, danych kart i zbędnych danych kupującego.

| Sytuacja | Pierwsza reakcja |
| --- | --- |
| Niejasna płatność lub wpłata po anulowaniu | Sprawdź bank/operatora i historię; zgłoś rozbieżność przed realizacją. |
| Niejasne nadanie, anulowanie lub brak numeru | Sprawdź Apaczkę z osobą techniczną; nie ponawiaj zlecenia. |
| Mail `uncertain` albo brak wiadomości | Zgłoś numer i rodzaj wiadomości; administrator porównuje kolejkę z logiem dostawcy. |
| Sklep niedostępny, alarm kopii lub dysku | Prowadzący sprawdza monitor, ostatnie wydanie i możliwość bezpiecznego odzyskania. |

Kanał zgłoszeń i osoba zastępująca: __________________________________

Pierwszy okres raportu SEO / termin artykułu: __________________________

Szablon: [Miesięczny raport utrzymania i SEO](szablon-raportu-seo-innochem.md). Brak danych zapisujemy jako brak danych, nie jako zero. Wiadomość w kolejce i zdarzenie GA4 nie są dowodem doręczenia ani pełną księgą sprzedaży.

<!-- pdf-pagebreak -->

## 6. Zapis szkolenia

Poniższe pola pozostają puste. Wypełniają je uczestnicy po rzeczywistym szkoleniu i testach; dokument nie zawiera podpisów ani deklaracji akceptacji.

| Pole | Do uzupełnienia |
| --- | --- |
| Data, uczestnicy i prowadzący szkolenie | __________________________________ |
| Adres i tryb środowiska szkoleniowego | __________________________________ |
| Wersja aplikacji i identyfikator wdrożenia | __________________________________ |
| Produkt, strona, fikcyjne zamówienia A-H | __________________________________ |
| Wyniki A-D / wyniki E-H | __________________________________ |
| Urządzenia i przeglądarki użyte przez klientkę | __________________________________ |
| Przekazane materiały i sposób przekazania | __________________________________ |
| Niewykonane ćwiczenia lub znalezione problemy | __________________________________ |

Szkolenie nie potwierdza automatycznie działania operatorów live. Dla testu produkcyjnego zapisujemy osobno adres innochem.pl, datę, numer kontrolnego zamówienia, dowód płatności, wynik nadania i odbiór maili. Zapisy pozostają bez sekretów i pełnych danych kart.

<!-- pdf-pagebreak -->

## 7. Decyzja odbiorcza

Data faktycznego uruchomienia innochem.pl: ___________________________

Zakres odebrany przez klientkę, wraz z dowodami: ______________________

_________________________________________________________________

Zakres otwarty, zastrzeżenia i warunki dalszego odbioru: _________________

_________________________________________________________________

Właściciel każdego działania oraz uzgodniony termin poprawy: ___________

_________________________________________________________________

Początek i koniec okresu opieki: _____________________________________

Potwierdzenie klientki: data oraz odnośnik/identyfikator jej odpowiedzi albo rzeczywisty podpis w osobnym protokole: ______________________________

Potwierdzenie wykonawcy i uzgodniony kanał wsparcia: __________________

Odbiór może dotyczyć uzgodnionej części zakresu, jeśli strony zapiszą pozostałe zależności. Nie oznaczamy jako wykonanych: P24 bez decyzji operatora, maili bez odbioru, wysyłki bez kontrolnego nadania, szkolenia bez samodzielnego ćwiczenia ani opieki bez rzeczywistej daty startu.

### Dokumenty pakietu

[Obsługa panelu](instrukcja-panelu-innochem.md) zawiera codzienne czynności. [Protokół uruchomienia](protokol-uruchomienia-innochem.md) zbiera dowody całego wydania, a [szablon raportu](szablon-raportu-seo-innochem.md) służy do późniejszej opieki. Datowane źródła i granice tego opracowania opisano w [notatce dla prowadzącego](zrodla-i-granice-2026-10-09.md).

Pakiet jest przygotowany do przeglądu. Wysyłka, szkolenie, przełączenie domeny, płatności i akceptacja wymagają rzeczywistego wykonania oraz zapisania wyniku przez uprawnione osoby.
