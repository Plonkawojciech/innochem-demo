# Obsługa panelu INNOCHEM

Panel znajduje się pod adresem `/admin`. Wymaga zalogowania na zweryfikowane konto administratora. Konto klienta nie ma do niego dostępu. Wersja z paskiem „Podgląd nowego sklepu” służy do sprawdzania zmian; zapisane w niej zamówienia i wiadomości nie są realizowane.

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

„Zapisz wykonany zwrot pieniędzy” dokumentuje zwrot wykonany wcześniej w banku lub panelu operatora. Ten przycisk nie przelewa pieniędzy. Sprawdź towar przed wybraniem przywrócenia stanu magazynu. Płatność wymagająca wyjaśnienia lub niepewna odpowiedź operatora powinna zostać uzgodniona z jego panelem przed dalszą obsługą.

## Zapytania i odstąpienia

„Zapytania” zbierają formularze kontaktowe, przemysłowe i dystrybucyjne. Zapisz status obsługi i notatkę wewnętrzną. Odpowiedź klientowi przygotuj w uzgodnionej skrzynce pocztowej; notatka nie jest wysłaną wiadomością.

„Odstąpienia” zawierają oryginalną treść oświadczenia i datę otrzymania. Możesz zmienić status i dodać notatkę, ale nie zmieniasz oświadczenia klienta. Zakończenie obsługi zgłoszenia nie wykonuje automatycznie zwrotu płatności ani nie zwiększa magazynu. Te czynności rozlicz w zamówieniu.

## Ustawienia, pliki i eksport

W „Ustawieniach” wpisuje się uzgodnione dostawy, płatności, adresy poczty obsługowej i wersję warunków. Zatwierdzaj je dopiero po sprawdzeniu cen i dokumentów. Sekrety operatora i poczty wprowadza osoba techniczna poza panelem treści.

„Pliki” to wspólna biblioteka zdjęć i dokumentów. „Eksport” umożliwia pobranie danych sklepu jako JSON, produktów i zamówień jako CSV oraz osobnego archiwum plików. Eksport z klientami i zamówieniami zawiera dane osobowe; zapisz go w prywatnym miejscu. Eksport panelu nie zastępuje zaszyfrowanej kopii technicznej opisanej w [instrukcji utrzymania](operations.md).

Przed szkoleniem przygotuj produkt testowy i wykonaj kolejno: zmianę ceny, wybór zdjęcia, edycję opisu, zapis szkicu strony, podgląd, obsługę syntetycznego zamówienia i eksport. Nie ćwicz płatności ani wysyłki na rzeczywistym zamówieniu klienta.
