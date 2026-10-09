# INNOCHEM: kontrolowana diagnoza LCP strony głównej

Cel: LCP poniżej 2500 ms w najgorszej próbie z zaplanowanej zimnej serii, z zachowaniem wyglądu i flow. Punkt wyjścia `e660067b896fdaf78e835dbd51450980d62a8869`. Aktualny raport QA zachowuje home 2729,151 / 1540,784 / 1548,497 ms oraz powtórzenie 1548,223 / 1551,003 / 1543,397 ms. Nie kasujemy ani nie zastępujemy nieudanego wyniku.

Przeczytano aktualny checkpoint z `2026-10-08-rano-dla-wojtka.md`, cały raport `independent-qa-fixes/REPORT.md` oraz diagnozę zapisanych śladów. Starszy nagłówek performance-followup opisuje `2506c40`, dlatego nie traktujemy go jako bieżącego wyniku. Installed Next/lockfile: 16.3.8; przeczytano lokalne instrukcje images, fonts, CSS i lazy-loading.

## Z góry ustalona seria

Pierwszy eksperyment: sześć zimnych prób publicznej strony głównej HTTPS na obecnym podglądzie. Lighthouse 13.5.0, systemowy Chrome 154.0.8037.98, osobny proces i świeży profil każdej próby; mobile 412×823/DPR1,75, simulate RTT150 ms, download1474,56 kbps, CPU4. Wynik laboratoryjny simulate pozostaje odrębny od natywnej obserwacji śladu. Root wstrzymał ciężkie prace zespołu, lecz na Macu pozostały ciężkie procesy obcych sesji. Load przekraczał 100. Nie udało się uzyskać cichego hosta; seria ma zakres diagnostyczny, nie stabilnej bramki. Runner zapisuje obciążenie hosta każdej próby.

Każda próba zachowuje LHR, HTML, Trace, DevtoolsLog i PID; runner zamyka swój proces. Serii nie powtarzamy po wyniku FAIL dla uzyskania green. Dalsza kontrola wymaga nowej, opisanej hipotezy potwierdzonej śladem. Nie zmieniamy flag GPU, transportu, wyglądu, zdjęć ani fontów dla pomiaru.

## Istniejący ślad i otwarta hipoteza

Nieudany home ma pobranie hero zakończone po 523,900 ms oraz prezentację LCP po 2492,829 ms; render delay1968,908 ms. Hero ma 13140 B, priorytet high i istnieje w początkowym HTML. Etap activation→submit1002,520 ms pokrywa zaledwie4,833 ms głównego wątku. Pierwszy Layout50,891 ms wall/31,606 ms CPU nie wyjaśnia całej przerwy. Kod nie potwierdza konkretnego winnego procesu lub błędu GPU.

Kandydat optymalizacji powstanie tylko po powiązaniu kosztu z kodem strony. Lokalny serwer produkcyjny będzie wyłącznie na przydzielonym3061; bazę55449/socket `/tmp/innochem-orchestrator-pg` prowadzi agent checkout. Środowisko lokalne wykorzysta osobną bazę i read-only GET, bez zapisu danych klientki.

## Stan

Gotowy runner `scripts/measure-home-lcp.mjs` wymaga istniejących dokładnych wersji Lighthouse i chrome-launcher oraz nowego katalogu wyników. Używa wyłącznie `https://sklep-innochem.programo.pl` lub `http://127.0.0.1:3061`. Root dostarczył niesekretny odczyt runtime z 19:52 CEST: obraz e660067 healthy, preview/worker true, payments/mail false.

Pierwszy start 18:04:17 UTC zatrzymał błąd runnera: nieutworzony katalog przekazanego profilu. Chrome wystartował przed błędem zapisu chrome.pid; nie powstał LHR ani pomiar strony. Wynik pozostaje w `private/lcp-20261009/baseline-https-six`; receipt cleanup zachowuje własny PID4964 i sześć dzieci, SIGTERM oraz sprawdzony brak procesów tego profilu po zakończeniu. Profil zachowano. Load97,83 przy ośmiu CPU i wolnej pamięci około195 MB pozostaje w nieudanej próbie.

Poprawka runnera tworzy nowy profil przed startem i przechowuje własną instancję Launcher już podczas launch; cleanup czeka na zdarzenie close własnego child process. To korekta konkretnego błędu instrumentacji, bez zmiany profilu, kodu strony lub polowania na green. Pierwotnie zadeklarowane sześć pomiarów zakolejkowano w nowym katalogu `baseline-https-six-fixed`, bez nadpisania nieudanej próby. Kod aplikacji pozostaje bez zmian.


## Osobna seria Linux VM

Root wskazał istniejący obraz `skup-fb-collector:local` z Chromium i Node na VM159.195.206.7. Poprawiony Mac runner anulowano w kolejce, przed utworzeniem katalogu wyników i przed pierwszą próbą strony; exit130, zero próbek. Błąd pierwszego launch pozostaje w archiwum.

Przed startem deklarujemy osobną serię sześciu zimnych home HTTPS. Lighthouse 13.5.0, identyczne parametry mobile i simulate; Linux Chromium 154.0.8037.92, Node v24.21.0, amd64. Obraz przypięty do `sha256:ea50dc50f7f9a231ebb842a78b868b16f89011a2efe3d770ff51d6bd78fc6f01`. Odczyt wersji nie otwierał strony. Load VM 6,18 / 5,92 / 6,00. To inny host i silnik, więc nie porównujemy Mac/VM jako przed/po poprawce kodu. Aplikacja nadal e660067, bez zmian źródeł.

Kontener QA ma limit 2 CPU / 2 GB / pids256, dropALL/no-new-privileges, użytkownika 1000 i czyste środowisko env-i. Używa świeżego własnego procesu i profilu każdej próby. Nie montuje wolumenów ani profilu kolektora, nie publikuje portów. Obraz deklaruje `/profile`; zastępujemy go własnym tmpfs 16 MB i sprawdzamy brak montowań typu volume/bind. Właściwy profil każdej próby jest w katalogu własnych wyników. Flagi Linux headless/no-sandbox zostają zapisane jako warunki tej osobnej serii, bez zmian GPU lub kodu strony. Własny payload obejmuje harness, niesekretny runtime proof i 100 istniejących zależności runtime Lighthouse/chrome-launcher; archiwum pomija .env*.

`scripts/run-home-lcp-vm.py` przeprowadza kolejne kroki przez jeden heavy: archiwum, transfer z SHA, nowy kontener, sześć prób, pobranie wyników i kontrolę SHA każdego pliku. Sprawdza czysty stan swoich źródeł względem commita, hash manifestu zależności oraz package.json każdego istniejącego pakietu. Nie formatuje ani nie zmienia źródeł podczas wykonania. Usuwa wyłącznie nowo utworzony zamknięty kontener z etykietą właściciela oraz jego wskazany katalog tymczasowy po zweryfikowanym pobraniu. Zapisuje obraz runtime jako immutable imageID, limity i przed/po obciążenie/pamięć VM. Późniejsza finalna seria po root deploy ma użyć tego samego obrazu/silnika/profilu.

## Historyczny stan przy zamrożeniu instrumentacji przed formalnym review

VM6: **NOT RUN**. Oczekujący helper anulowany przed przejęciem heavy; exit130, brak payloadu i zero próbek strony. Kod aplikacji pozostaje na e660067 i nie ma zmian. Root poprosił o osobny commit instrumentacji przed formalnym static review. Wyniki oraz dowód wykonania zostaną zapisane w kolejnym commicie.

Własne pliki: runner, offline parser, helper VM, manifest nazw/wersji/hashów package.json 100 zależności i ten checkpoint. Nie commitujemy pakietów, profili, raw trace ani danych klientki. Syntax `node --check scripts/measure-home-lcp.mjs` oraz `python3 -m py_compile scripts/analyze-home-lcp.py scripts/run-home-lcp-vm.py`: PASS. Walidacja parsera na śladzie historycznym i sześć pomiarów nie zostały jeszcze wykonane.

Następny krok: formalny review exact SHA, potem uruchomienie zamrożonego helpera przez heavy. Duże artefakty pozostaną na Mad Dog; raport zachowa wszystkie próby oraz ich hashe. Serwera3061 nie uruchamiano; PG55449 pozostaje własnością checkout. Własny Chrome po błędzie launcher zakończony, co potwierdza zachowany receipt; kontener inwentaryzacji był --rm, benchmarkowego kontenera nie utworzono.

Draft review wykazał dwa P2 w helperze: archiwizacja argv przed walidacją runtime proof oraz cleanup wyłącznie po sukcesie. Poprawka przed wykonaniem dopuszcza tylko dwa regularne canonical JSON w katalogu orkiestracji, odrzuca .env, symlinki, nieznane pola i metadane niezgodne z SHA/preview. Do payloadu trafia ponownie serializowany, zwalidowany obiekt; nie archiwizujemy pierwotnego argv. Zdalny trap i lokalne finally zatrzymują kontener wyłącznie po zgodności exact ID oraz dwóch etykiet właściciela. Niezaufane lub niezweryfikowane wyniki pozostają zachowane. Limit startu900 s zabezpiecza także utratę klienta SSH. Zasoby usuwamy dopiero po hash-verified pobraniu. VM6 nadal NOT RUN.

Walidacja funkcji wejścia, bez SSH/kontenera/browsera: 1 poprawny proof oraz 9 odrzuconych przypadków (nieznane pole, arbitralne source, healthy typu liczbowego, payments true, niezgodne SHA, trzy niedozwolone ścieżki i symlink); PASS. Syntax parsera/helpera oraz git diff --check: PASS. Cleanup zdalny pozostaje do potwierdzenia po formalnym review i rzeczywistym wykonaniu; nie raportujemy go jako wykonanego.


## Zakończona baseline VM6: FAIL, 9 października 21:31 CEST

Exact instrumentacja `92d213b50965b75a6af6fcc17e1e51e340061f04` dostała formalny static GO. Jedna zadeklarowana seria ruszyła po zwolnieniu heavy i zamknęła sześć prób 19:30:57–19:31:43 UTC. Preview nadal `e660067b896fdaf78e835dbd51450980d62a8869`; nie było zmian kodu aplikacji. Wszystkie sześć wyników jest ważnych, bez błędów HTTP, bez zapisu requestem i z potwierdzonym zamknięciem własnego browsera. CLS każdej próby: 0. Exit0 pipeline potwierdza wykonanie, a nie zaliczenie celu.

| Próba | Lighthouse LCP simulate, ms | Natywny LCP śladu, ms | TBT, ms | LCP <2500 |
| --- | ---: | ---: | ---: | --- |
| 1 | 2709,861 | 1281,132 | 242 | FAIL |
| 2 | 2789,144 | 219,857 | 324 | FAIL |
| 3 | 2552,829 | 171,822 | 169 | FAIL |
| 4 | 2725,752 | 205,949 | 305 | FAIL |
| 5 | 2471,293 | 182,406 | 196,5 | PASS |
| 6 | 2534,278 | 185,217 | 179 | FAIL |

Najgorsza próba 2789,144 ms; `targetAllPassed=false`, pięć FAIL. Zachowano wszystkie próby. Host VM ma 8 CPU, load1 od 5,13 przez 6,30 do 4,90 i około 7 GB wolnej pamięci. Kontener QA ma niezmieniony limit 2 CPU/2 GB. Nie uznajemy wcześniejszego Maca i tej VM za porównywalną serię przed/po. Szczegółowe parametry, czasy, obciążenie każdej próby oraz wszystkie hashe zawiera [baseline evidence](../evidence/2026-10-09-home-lcp-baseline-vm.json).

Zdalne zasoby własnego QA usunięto dopiero po zgodności SHA archiwum oraz 27 plików wynikowych. Receipt potwierdza zamknięcie sześciu browserów i cleanup kontenera/katalogu. Archiwum wyników SHA256 `cedd6f73f3842cfc5d1c03cbb5a8de327310cbc40405c4d484ba03d144e5a663`. Raw LHR/HTML/Trace/DevtoolsLog, payload i receipt pozostają na Mad Dog w `private/lcp-20261009/baseline-six-vm` oraz `baseline-six-vm-results.tar.gz`; nie trafiają do Git. Offline parser sześciu śladów oraz historyczne golden assertions (natywny LCP2492,829 ms, activation→submit1002,520 ms) zakończyły się PASS. Dodatkowy ograniczony odczyt CPU ze śladów 2 i 5 wykonano przez heavy, bez browsera ani sieci.

### Koszt renderowania: najgorsza próba 2 i najlepsza 5

Pierwszy Layout obejmuje cały dokument i 305 obiektów w obu próbach: 55,009/50,921 ms wall oraz 15,400/15,379 ms CPU. `SendBeginMainFrameToCommit` zajmuje 66,702/57,046 ms, niemal w całości pokryte zadaniami głównego wątku. `activation→submit` to 1,031/5,807 ms; brak powtórzenia historycznej sekundowej przerwy Maca. Nie ma podstaw do usuwania efektów lub zmiany compositora.

Próba1 zachowuje osobny natywny outlier1281,132 ms: activation→submit978,645 ms, RunTask głównego wątku110,403 ms i868,242 ms poza nim. Zapisane zdarzenia innych wątków renderera obejmują odpowiednio42,911/26,036/25,958/21,158 ms workerów oraz6,380 ms compositora. Te przedziały mogą się nakładać; nie sumujemy ich i nie mamy z tego dowodu aktywności osobnego procesu GPU. Sama korekta offscreen style/layout nie wyjaśnia tej przerwy i nie jest gwarancją jej usunięcia. Wszystkie etapy prezentacji sześciu śladów oraz detale outliera1 są zachowane w bounded evidence.

Wykonanie core chunk3794 zaczyna się przed natywnym LCP: 91,782/51,602 ms wall oraz 49,609/44,735 ms CPU. To Next/React routing i hydration, a nie dowód konkretnej wolnej funkcji aplikacji. Ślad nie zawiera leaf CPU samples. Większa różnica wall niż CPU może wynikać z planowania lub limitu kontenera; brak cpu.stat nie pozwala przypisać przyczyny. Nie zmieniamy limitu QA ani vendor bundle.

Audit Lighthouse skaluje bootup-time i grupy main-thread przez CPU4: koszt style/layout279,092/271,244 ms, script evaluation553,532/479,516 ms. CSS blokujący jest identyczny, 11874 B i 150 ms w obu. Są to czasy przeskalowanego auditu, nie natywne CPU. Lighthouse Lantern uwzględnia całe zadanie zaczynające się przed natywnym LCP, nawet jeśli kończy się po prezentacji. Optymalizacja ma zmniejszyć rzeczywistą pracę strony, bez modyfikacji miernika.

Następny krok to jedna korekta offscreen style/layout sekcji technology i featured, z zachowaniem cienia, Reveal, anchorów, focusu, drukowania i DOM. Jej skuteczność pozostaje hipotezą do sprawdzenia; nie wyprowadzamy gwarancji <2500 ms z tych kosztów. Po review root wykona jeden finalny pełny gate i deploy; kolejna z góry ustalona VM6 zachowa wszystkie próby oraz ten sam silnik, instrumentację i limity. Brak własnego serwera3061 i własnej bazy. PG55449 pozostaje w opiece checkout.

## Kandydat: pomijanie renderowania dwóch odległych sekcji

Jedna ograniczona hipoteza: `content-visibility:auto` na sekcji technology i na istniejącym root Reveal featured ograniczy pracę pierwszego style/layout poza ekranem. Dwa nowe selektory mają lokalne nazwy `home-deferred-*`; nie obejmują hero ani innych stron. Markup, linki Next, obrazki, priorytety, fonty, koszyk i logika Reveal pozostają identyczne. Observer Reveal widzi sam root zawierający content-visibility; nie mierzy pomijanych potomków.

Reguły działają wyłącznie dla screen i przeglądarek rozumiejących wszystkie trzy właściwości. `contain-intrinsic-block-size:auto` zapamiętuje wyrenderowaną wysokość; początkowe szacunki desktop460/600 px oraz jednokolumnowe850/1000 px utrzymują miejsce przed renderowaniem. To szacunki, nie zmiana docelowej wysokości. `overflow-clip-margin:200px` zachowuje przestrzeń na dotychczasowy cień produktu (blur50px i offset30px) oraz focus. Przeglądarki bez tej właściwości renderują poprzedni układ. Drukowanie nie dostaje containment. Semantyka auto zachowuje DOM, find i focus; zasady wynikają z [opisu Chrome](https://web.dev/articles/content-visibility) oraz [CSS Containment 2](https://www.w3.org/TR/css-contain-2/) i [CSS Overflow 3](https://www.w3.org/TR/css-overflow/).

Zmienione pliki aplikacji: `components/HomeContent.tsx`, `app/globals.css`. `git diff --check`: PASS. **Build, typecheck, format, browser flow oraz finalna VM6: NOT RUN dla tego kandydata.** Root prowadzi review exact SHA, jedną wspólną bramkę i deploy. Potrzebne sprawdzenie na bieżącym źródle: scroll do obu sekcji i Reveal `.in`, bez poziomego overflow i ucięcia cienia/focusu; wejście bezpośrednio przez `/#technologia` i `/#produkt`; Tab/Shift+Tab do CTA featured oraz Enter do katalogu/produktu; DOM/a11y obecnych treści; screen320/412/900/1440 i print bez containment. Szczególnie trzeba porównać screenshot oraz wysokości/pozycje po pełnym wyrenderowaniu z kontrolą `content-visibility:visible`, by sprawdzić wygląd i geometrię.

Przed startem deklarujemy jedną finalną serię `final-six` po wdrożeniu root: sześć zimnych publicznych home HTTPS, ten sam frozen runner/image/browser/profile/limity co baseline. Zapisujemy wszystkie sześć wyników, niezależnie od fail. Sukces wymaga sześciu ważnych, zamkniętych prób oraz `worstLcp<2500` i `targetAllPassed=true`. Hipoteza nie jest jeszcze potwierdzona pomiarem. Brak build artefaktów do sprzątnięcia i brak własnego aktywnego browsera/servera.
