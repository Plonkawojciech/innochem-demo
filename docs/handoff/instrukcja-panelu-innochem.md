# Obsługa sklepu INNOCHEM

Wersja robocza do przekazania po testach operatorów i uruchomieniu domeny. Aktualny podgląd: https://sklep-innochem.programo.pl. Po przełączeniu używamy https://innochem.pl. Logowanie: `/konto/logowanie`; panel: `/admin`. Hasła nie trafiają do tej instrukcji. Konto klienta i konto obsługi mają oddzielne uprawnienia.

## Produkty i magazyn

W panelu Produkty wybierz produkt, popraw treść, zdjęcia, cenę i stan, a potem zapisz. Stan dostępny klientowi uwzględnia rezerwacje nieopłaconych zamówień. Nie obniżaj stanu poniżej zarezerwowanej ilości. Gdy ktoś równocześnie zmieni produkt, panel poprosi o odświeżenie; sprawdź aktualne wartości przed kolejnym zapisem. Produkt archiwalny zachowuje historyczne pozycje zamówień. Produkty przemysłowe przyjmują zapytania zamiast zakupów.

Wagi oznaczają rzeczywistą masę produktu. Wymiary i masę gotowej paczki podaje się osobno przy nadaniu. Nie wykorzystuj przykładowego kartonu jako potwierdzonego opakowania.

## Zamówienia i płatności

Otwórz Zamówienia i wybierz konkretny numer. Historia wskazuje utworzenie, potwierdzenie płatności, realizację, wysyłkę i rozliczenia. Powrót kupującego ze strony Stripe nie jest dowodem zapłaty: status aktualizuje zweryfikowane potwierdzenie operatora. Przy niejasnym wyniku użyj Sprawdź płatność w Stripe; nie potwierdzaj ręcznie wpływu, którego nie ma.

Przelew tradycyjny potwierdzaj dopiero po sprawdzeniu wyciągu bankowego. Wpisz faktyczną kwotę i numer potwierdzenia. Kwota musi zgadzać się z zamówieniem. Nieopłacone zamówienie można anulować; system zwolni jego rezerwację. Pobranie rezerwuje/rozlicza magazyn zgodnie ze statusem realizacji i nie oznacza wpływu pieniędzy przez Stripe.

Jeżeli po anulowaniu przyjdzie płatność, zamówienie trafia do wyjaśnienia. Sprawdź dostępność towaru i rzeczywiste rozliczenie z kupującym przed dalszym działaniem.

## Kurier i odbiór osobisty

Odbiór osobisty odbywa się w Kielcach po ustaleniu terminu; nie nadaje się dla niego paczki. Zamówienie kurierskie musi mieć odpowiedni status i rozliczony magazyn.

W sekcji Przesyłka wybierz dostępną usługę. Wpisz zewnętrzne wymiary i wagę każdej zapakowanej paczki; w jednym zleceniu można dodać kilka paczek. Szablon przyspiesza wpisywanie, lecz trzeba sprawdzić go z rzeczywistym opakowaniem. Jeżeli usługa wymaga odbioru przez kuriera, wybierz datę.

Najpierw pobierz wycenę. Sprawdź usługę, liczbę paczek i koszt, potwierdź dane, a następnie nadaj. Wycena jest ważna pięć minut; zmiana danych wymaga nowej. Koszt operatora nie zmienia ceny wcześniej złożonego zamówienia. Płatność przy pobraniu dotyczy całego zlecenia, a nie każdej paczki osobno.

Tryb testowy Apaczki nie zamawia realnego kuriera. Przed nadaniem rzeczywistym administrator techniczny musi potwierdzić konfigurację produkcyjną. Gdy nadanie ma wynik niejednoznaczny, sprawdź panel Apaczki i skontaktuj się z administratorem; nie klikaj ponownie. Anulowanie przesyłki nie anuluje zamówienia ani płatności. Pobranie PDF etykiety jest osobną czynnością. Po zapisaniu faktycznego numeru i przekazaniu paczki oznacz zamówienie jako wysłane.

Zamówienie ze zwrotem pieniędzy lub przyjętym zwrotem towaru wymaga wyjaśnienia zakresu dalszej wysyłki. Panel nie nadaje automatycznie pierwotnego pełnego koszyka i pobrania.

## Odstąpienia, refundacje i przyjęcie towaru

Zgłoszenie w Odstąpienia zachowuje oryginalną treść klienta. Wewnętrzna notatka i status nie zmieniają oświadczenia. Sprawdź termin, zakres i dokumenty sprawy.

Zwrot pieniędzy wykonuje się u operatora albo w banku. Dopiero po jego wykonaniu wybierz Zapisz wykonany zwrot pieniędzy, wpisz kwotę, potwierdzenie i uzasadnienie. Wskaż właściwe pozycje, ilości, kwoty oraz ewentualny zwrot dostawy. Można rozliczyć część zamówienia; korekta samej kwoty ma ilość 0. Panel nie wysyła pieniędzy i nie przywraca automatycznie towaru.

Towar nadający się do ponownej sprzedaży przyjmij osobno przez Przyjmij zwrócone sztuki do magazynu. Podaj faktycznie otrzymane sztuki i dowód przyjęcia. Nie można drugi raz przyjąć tej samej ilości. Jeśli nie masz pewności, czy poprzedni zapis się udał, odśwież historię przed kolejną operacją.

## Ustawienia, treści i wiadomości

Stawki dostawy, darmowy próg, pobranie i limit COD muszą odpowiadać zatwierdzonym warunkom sprzedaży. Zmiana tych zasad wymaga nowej wersji dokumentów. Nie zatwierdzaj danych pakowania, których nie sprawdzono. Dostępność metod online zależy również od decyzji Stripe na koncie firmy.

W panelu treści edytuje się strony informacyjne. Zmiana dokumentu prawnego zamyka zakup do zatwierdzenia nowej wersji; to zabezpiecza zgodność warunków akceptowanych przez kupującego.

Wpis wiadomości w kolejce nie jest potwierdzeniem doręczenia. Status `uncertain` oznacza, że dostawca mógł przyjąć wiadomość; przed ponowną wysyłką administrator sprawdza jego log. Podgląd nie wysyła do klientów dawnych wiadomości testowych po uruchomieniu sklepu.

## Zgłoszenia i opieka

Zgłoszenia przekazuj mailowo albo telefonicznie do osoby prowadzącej projekt. Podaj numer zamówienia, widoczny komunikat i moment wystąpienia; nie przesyłaj haseł, kluczy API ani pełnych danych kart. Zgodnie z umową obsługa i pozycjonowanie trwają 12 miesięcy od uruchomienia na domenie docelowej; pakiet obejmuje do pięciu godzin zmian miesięcznie. Datę startu i kanał wsparcia wpisujemy w protokole odbioru po ich potwierdzeniu.
