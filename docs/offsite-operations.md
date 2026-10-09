# Kopia Innochem poza VM i alarmy

Decyzja Wojtka z 9.10.2026: używamy istniejącego Hetzner Storage Box oraz kanałów Programo. Odbiorca maila to `wojciech.plonka@programo.pl`; push trafia do istniejącego ntfy, którego adres pozostaje w konfiguracji monitora. Nie tworzymy kont, usług ani kluczy.

## Zakres kopii

Istniejące `programo-offsite-restic.timer` uruchamia kopię codziennie o 04:45 w strefie `Europe/Warsaw`. Zadanie `/opt/programo-infra/offsite_restic.sh` już obejmuje `/root/backups/innochem`; nie wymaga zmiany listy źródeł ani drugiego pełnego backupu.

SSH `storagebox-vm` używa podkonta `sub2`, portu 23 i katalogu ograniczonego do `/firma/backupy-vm`. Repozytorium jest wewnątrz tego katalogu: `sftp:storagebox-vm:restic`. Hasło odczytuje sam restic z istniejącego `/root/.config/restic/vm.pass`. Nie kopiujemy hasła i nie odczytujemy plików `.env*`.

`ops/offsite-host.py` sprawdza identyfikator ostatniej udanej kopii wspólnego zadania. Wymaga snapshotu z tagiem `vm`, potwierdzonych źródeł, wieku najwyżej 30 godzin, poprawnego lokalnego gzip SQL nie starszego niż 34 godziny i braku `LAST_BACKUP_FAILED`. Rekurencyjny indeks plików mediów w snapshotcie musi zgadzać się z lokalnym lustrem pod względem ścieżek i rozmiarów.

Weryfikator odtwarza najnowszy dump oraz jedną małą próbkę mediów, razem najwyżej 2 MiB. Porównuje rozmiary i SHA-256; odzyskany dump dodatkowo przechodzi kontrolę gzip. Prywatny katalog roboczy znika po sprawdzeniu. Stan w `/root/innochem-monitor/offsite-status.json` zawiera wyłącznie metadane i hashe, bez treści SQL, mediów, sekretów czy danych kupujących.

Limit pobierania wynosi 4096 KiB/s. Weryfikator ponownie używa istniejącego cache restic na VM, ponieważ każde wywołanie bez cache pobiera duży indeks całego repozytorium. Nie usuwa tego współdzielonego cache ani kopii. Własne procesy restic i SSH działają w osobnej grupie; timeout kończy wyłącznie tę grupę.

Drop-in `programo-offsite-restic.service.d/90-innochem-verify.conf` dopisuje `ExecStartPost` po sukcesie istniejącego zadania. Nie kasuje wcześniejszych poleceń. Oryginalne polecenie kopii i retencja pozostają niezmienione. Błąd weryfikacji trafia do osobnego statusu Innochem i alarmu; nie zastępuje wyniku samego backupu.

Nie jest to test pełnego odtworzenia działającej aplikacji, bazy i wszystkich mediów. Indeks potwierdza kompletność ścieżek oraz rozmiarów, a hashe potwierdzają zawartość dwóch odtworzonych plików. Lokalny backup SQL i lustro mediów nie stanowią jednego wstrzymanego snapshotu całej aplikacji.

## Alarmy

`ops/monitor-host.sh` zachowuje wynik sondy kontenera, HTTPS, heartbeat, lokalnego backupu, dysku oraz zaległych kolejek. Następnie uruchamia `ops/offsite-alerts.py`, który dodatkowo sprawdza świeżość zweryfikowanej kopii Innochem poza VM oraz błąd wspólnego zadania restic.

Powiadomienia korzystają z istniejących `infra_monitor.channels()` oraz maszyny stanów, opisów i nadawców `programo_alerts` na VM. Klucz Resend przebywa wyłącznie w pamięci procesu, pobrany z działającego runtime. Guard wymaga zgodności istniejącego odbiorcy z zatwierdzonym adresem oraz dostępnego ntfy i klucza. Osobny kod HTTP Innochem dodaje ochronę przed duplikatem; nie modyfikuje wspólnego modułu ani SMTP sklepu.

Stan deduplikacji Innochem jest oddzielny od wspólnego monitora Programo: `/root/innochem-monitor/alerts-state.json`. Email i push prowadzą niezależny stan tej samej maszyny alarmów. Zgłoszenie następuje po dwóch kolejnych błędnych sprawdzeniach, przypomnienie po 12 godzinach, a „rozwiązane” po trzech poprawnych. Przy cron co 5 minut oznacza to około 10 i 15 minut. Nie ponawiamy kanału, który już przyjął daną wiadomość; nieskuteczny kanał ponawia próbę wyłącznie dla siebie. Po ustąpieniu problemu każdy kanał, który przyjął alarm, otrzymuje własne „rozwiązane”. Kolejny incydent uruchamia ponownie normalne zgłoszenie.

Przed pierwszym POST zapisujemy identyfikator konkretnego incydentu i etapu, wybrany nadawca, dokładny temat oraz treść. Resend otrzymuje `Idempotency-Key`; ponowienie zachowuje payload. [Resend przechowuje te klucze przez 24 godziny](https://resend.com/docs/dashboard/emails/idempotency-keys). Na minutę przed końcem tego okna kod zatrzymuje POST i zachowuje `IDEMPOTENCY_WINDOW_EXPIRED`, zamiast tworzyć nowy mail. Nadawca zapasowy może wejść dopiero po jednoznacznym odrzuceniu domeny przy pierwszej próbie; jego wybór również zapisujemy przed POST.

Przy zgubionej odpowiedzi ntfy kod odczytuje ograniczony cache wiadomości z filtrem tematu i identyfikatorem zdarzenia w treści, [zgodnie z API ntfy](https://docs.ntfy.sh/subscribe/api/). Nie powtarza niepewnego POST. Decyzję „publikuj” albo „uzgodnij wynik” zapisuje przed rozpoczęciem konkretnej próby. Odzyskany znacznik `inFlight` wymusza uzgodnienie nawet wtedy, gdy wcześniejsza próba otrzymała 429. Dopiero znalezienie zapisanego komunikatu potwierdza przyjęcie. Brak potwierdzenia pozostawia stan `uncertain`; należy porównać logi dostawcy i zapisany identyfikator, zanim operator odblokuje kolejną wysyłkę.

Niepewna wysyłka wstrzymuje maszynę powiadomień wyłącznie swojego kanału do czasu potwierdzenia. Drugi kanał i rzeczywista sonda sklepu nadal działają. Po uzyskaniu potwierdzenia recovery wymaga kolejnych trzech dobrych kontroli. Stan próby zapisujemy przed POST i po każdym kanale, również gdy proces przerwie się między emailem a push.

Kod zachowuje kod błędu sondy. Jeżeli sama sonda jest zdrowa, lecz dostarczenie alarmu zawiodło, wrapper również zwraca błąd. Samo przyjęcie maila przez Resend nie jest dowodem pojawienia się wiadomości w skrzynce; do raportu odbioru należy dopisać zdarzenie `delivered` z logów dostawcy, jeżeli jest dostępne.

Testy kanałów `--test failure` i `--test recovery` korzystają z osobnego `alerts-test.json`. Wiadomości są oznaczone jako test, żaden kontener, port, provider ani wynik produkcyjnej sondy nie ulega zmianie. W ramach odbioru wykonujemy jedną parę i zachowujemy jej potwierdzenia; kolejna para byłaby osobnym testem kanałów.

## Odczyty i testy

Sprawdzenie bez wysyłki:

```sh
python3 -B /root/innochem-monitor/offsite-alerts.py --check
```

Ponowna ograniczona weryfikacja istniejącego snapshotu:

```sh
nice -n 15 ionice -c 3 python3 -B /root/innochem-monitor/offsite-host.py
```

Nie uruchamia ona nowej kopii, retencji ani pruning. Nie trzeba podawać hasła w konsoli.

Testy w repozytorium:

```sh
node --test tests/offsite-host.test.mjs tests/offsite-alerts.test.mjs
```

Odtworzenie sprawdzone 9.10 o 06:57 UTC użyło snapshotu `0ed5f3c8fc30ad875e98e9b7982a23e79d3685fbff642c5469101a94d9dad4b5`, utworzonego tego dnia o 04:45 Warszawa. Zgadzało się 3418 plików mediów (156 795 882 B). Odzyskane 909 704 B obejmowało dump 876 044 B i próbkę mediów 33 660 B; oba SHA-256 odpowiadały plikom źródłowym. Weryfikacja nie zmieniła żadnego klienta, zamówienia, płatności ani pliku mediów. Jeżeli dump po wzroście sklepu przekroczy limit odtworzenia, weryfikator zgłosi jawnie brak weryfikacji; nie oznacza to usunięcia ani uszkodzenia samego snapshotu. Wtedy AI powinno przygotować nową strategię ograniczonego odtworzenia.
