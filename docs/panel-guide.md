# Obsługa panelu INNOCHEM

Otwórz [panel podglądu](https://sklep-innochem.programo.pl/admin). Jeśli nie jesteś zalogowana, sklep przeniesie Cię do `/konto?returnTo=admin`; po logowaniu wrócisz do panelu. Użyj istniejącego, zweryfikowanego konta administratora. Konto klienta nie ma tych uprawnień. Po uruchomieniu domeny docelowej wejście będzie pod https://innochem.pl/admin. W obecnym podglądzie zakupy i dostarczanie wiadomości pozostają wyłączone.

## Produkty i magazyn

W „Produktach” wyszukaj pozycję i otwórz edycję. Możesz zmienić nazwę, cenę brutto, opis, kategorie, parametry, stan, galerię i dokumenty. Opis edytuje się wizualnie: zaznacz tekst, aby go pogrubić, dodać nagłówek, listę lub odnośnik.

Zdjęcie wybierz z biblioteki lub wgraj nowy plik. Ustaw kolejność galerii i tekst opisujący zdjęcie; pierwsze zdjęcie jest okładką produktu. W dokumentach wybierz PDF, zmień podpis i kolejność. Odpięcie zdjęcia lub dokumentu od produktu nie kasuje oryginalnego pliku z biblioteki. Stare karty produktu i charakterystyki są oznaczone jako archiwalne; oznaczenie usuń dopiero po zastąpieniu ich właściwym, aktualnym dokumentem.

Po edycji zapisz zmiany i sprawdź publiczną kartę produktu. Jeśli inna osoba w międzyczasie zmieniła tę samą pozycję, panel poprosi o odświeżenie zamiast nadpisać jej pracę. Stan nie może być mniejszy od liczby sztuk zarezerwowanych w zamówieniach. Wycofując towar, użyj archiwizacji; historyczne zamówienia zachowają swoją zawartość.

## Strona główna, menu i informacje

„Wygląd i treści witryny” obejmuje stronę główną, nawigację, stopkę, dane kontaktowe i strony przemysłu, kontaktu oraz dystrybutorów. Zmieniaj teksty, zdjęcia, kolejność i widoczność sekcji. Wyróżniony produkt jest powiązany z katalogiem, więc korzysta z jego aktualnej nazwy, adresu i zdjęcia.

Zapis szkicu nie publikuje zmian. Otwórz podgląd, sprawdź komputer i telefon, następnie opublikuj przygotowaną wersję. Podgląd szkicu jest dostępny tylko administratorowi. Historia pozwala przywrócić wcześniejszą wersję jako szkic, który można obejrzeć przed publikacją.

„Treści” służą do pozostałych stron informacyjnych i dokumentów prawnych. Zaimportowane materiały historyczne pozostają szkicami, dopóki nie zostaną świadomie wybrane do publikacji. Zmiana dokumentu prawnego wymaga ponownego zatwierdzenia warunków sprzedaży. Zamówienia zachowują wersję warunków zaakceptowaną w chwili zakupu.

## Zamówienia

Otwórz zamówienie, sprawdź płatność, dane i pozycje. Dla przelewu tradycyjnego potwierdź wpłatę dopiero po jej zaksięgowaniu i wpisz identyfikator potwierdzenia. Płatność Stripe jest potwierdzana przez operatora; sam powrót klienta do sklepu nie oznacza zapłaty.

Wybierz rozpoczęcie realizacji, a po nadaniu przesyłki oznacz zamówienie jako wysłane i wpisz numer przesyłki. Zapisany status trafia do historii. Zamówienia zaimportowane ze starego sklepu są archiwum i nie uruchamiają nowych płatności ani zmian magazynowych.

„Zapisz wykonany zwrot pieniędzy” dokumentuje zwrot wykonany wcześniej w banku lub panelu operatora. Ten przycisk nie przelewa pieniędzy ani nie przywraca magazynu. Wpisz faktyczną kwotę, potwierdzenie i uzasadnienie; wskaż pozycje, ilości oraz ewentualny zwrot dostawy. Korekta samej kwoty ma ilość 0.

Towar otrzymany i nadający się do sprzedaży przyjmij osobno przez „Przyjmij zwrócone sztuki do magazynu”. Wpisz faktyczne ilości i potwierdzenie przyjęcia. Gdy wynik zapisu jest niejasny, odśwież historię przed ponowieniem. Płatność wymagającą wyjaśnienia uzgodnij z panelem operatora przed dalszą obsługą.

## Zapytania i odstąpienia

„Zapytania” zbierają formularze kontaktowe, przemysłowe i dystrybucyjne. Zapisz status obsługi i notatkę wewnętrzną. Odpowiedź klientowi przygotuj w uzgodnionej skrzynce pocztowej; notatka nie jest wysłaną wiadomością.

„Odstąpienia” zawierają oryginalną treść oświadczenia i datę otrzymania. Możesz zmienić status i dodać notatkę, ale nie zmieniasz oświadczenia klienta. Zakończenie obsługi zgłoszenia nie wykonuje automatycznie zwrotu płatności ani nie zwiększa magazynu. Te czynności rozlicz w zamówieniu.

## Ustawienia, pliki i eksport

W „Ustawieniach” wpisuje się uzgodnione dostawy, płatności, adresy poczty obsługowej i wersję warunków. Zatwierdzaj je dopiero po sprawdzeniu cen i dokumentów. Sekrety operatora i poczty wprowadza osoba techniczna poza panelem treści.

„Pliki” to wspólna biblioteka zdjęć i dokumentów. „Eksport” umożliwia pobranie danych sklepu jako JSON, produktów i zamówień jako CSV oraz osobnego archiwum plików. Eksport z klientami i zamówieniami zawiera dane osobowe; zapisz go w prywatnym miejscu. Eksport panelu nie zastępuje zaszyfrowanej kopii technicznej opisanej w [instrukcji utrzymania](operations.md).

Przed szkoleniem przygotuj produkt testowy i wykonaj kolejno: zmianę ceny, wybór zdjęcia, edycję opisu, zapis szkicu strony, podgląd, obsługę syntetycznego zamówienia i eksport. Nie ćwicz płatności ani wysyłki na rzeczywistym zamówieniu klienta.

## Prywatność i statystyki

W stopce sklepu jest link „Ustawienia prywatności”. Klient decyduje w nim, czy zgadza się na statystykę odwiedzin (Google Analytics). Bez zgody sklep nie uruchamia żadnego skryptu Google; zakupy działają tak samo. Decyzję klient może zmienić w każdej chwili w tym samym miejscu.

W panelu „Kolejka analityki” widać zdarzenia o zakupach i zwrotach przeznaczone do Google Analytics: status (oczekuje, wysłane, pominięte, błąd), numer zamówienia i ewentualny powód pominięcia (np. brak zgody klienta albo pobranie, które nie jest jeszcze zapłatą). To podgląd tylko do odczytu; sprzedaż zawsze liczy się z zamówień w panelu, nie z Google. Sama obecność zdarzenia w kolejce nie potwierdza jego odbioru w Google.

Raport miesięczny przygotowuje wykonawca na podstawie Google Search Console (ruch z wyszukiwarki, pozycje fraz) i zamówień z panelu.

## Apaczka: nadanie i etykieta

Otwórz zamówienie i sekcję „Przesyłka”. Wybierz usługę Apaczki oraz szablon paczki, a następnie sprawdź rzeczywiste wymiary i wagę każdej zapakowanej paczki. Domyślny „Karton 4 butelki” to przykład do zmiany. Podaj datę, jeśli zamawiasz odbiór przez kuriera; bez daty wybierasz samodzielne nadanie, o ile usługa na to pozwala. Odbiór osobisty nie wymaga kuriera.

Kliknij „Sprawdź koszt nadania”. Wycena jest ważna pięć minut. Zmiana usługi, paczek lub daty wymaga nowej wyceny; sklep sprawdza także zgodność danych zamówienia. Potwierdź wycenę, usługę, odbiorcę i parametry wszystkich paczek, a następnie kliknij „Nadaj przez Apaczkę”. Nadanie rzeczywiste może obciążyć konto według umowy z operatorem. Testy wykonuj w uzgodnionym środowisku sandbox.

Po przyjęciu zlecenia możesz pobrać etykietę PDF. Numer listu czasem pojawia się dopiero przy pobraniu etykiety; jego brak nie oznacza potrzeby ponownego nadania. Dla pobrania system przekaże całą kwotę brutto zamówienia, włącznie z dostawą, oraz rachunek z Ustawień sklepu. Anulowanie przesyłki nie anuluje zamówienia ani płatności. Status „wysłane” ustaw po faktycznym przekazaniu paczki, osobno w Obsłudze zamówienia.

Gdy nadanie lub anulowanie oczekuje na wyjaśnienie, sprawdź panel Apaczki i przekaż sprawę administratorowi technicznemu. Nie ponawiaj operacji w ciemno; blokada pozostaje do uzgodnienia wyniku. Zamówienie po refundacji lub przyjęciu zwrotu również wymaga ustalenia dalszego zakresu wysyłki. Bez konfiguracji Apaczki nadal możesz wpisać faktyczny numer przesyłki w operacji „Oznacz jako wysłane”.
