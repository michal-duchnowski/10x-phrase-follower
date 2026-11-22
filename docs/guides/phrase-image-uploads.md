# Zdjęcia fiszek i konfiguracja DigitalOcean

Zdjęcia wklejane ze schowka lub wybierane z pliku są przechowywane na dysku Dropleta. Supabase przechowuje tylko ścieżkę w `phrases.image_url`. Obecne linki HTTPS nadal działają. Zdjęcie należy do frazy, więc jest wspólne dla obu kierunków fiszki i widoków nauki.

## Dodawanie zdjęć

### Seryjne ilustracje z ZIP

W notatniku zaznacz fiszki i wybierz **Add illustrations**. Ten sam wizard jest dostępny w listach Hard i w sekcji Difficult cards (również Again + Hard). W Difficult cards startuje z aktualnie wyświetlanym zestawem; w pierwszym kroku możesz usunąć niechciane pozycje. Oba kierunki tej samej frazy są łączone. Limit to 200 unikalnych fraz.

1. W bloku akcji zaznaczonych fiszek wybierz **Add illustrations**. Wybierz styl (domyślnie „Różnorodne, kwadratowe ilustracje.”) i skopiuj prompt zawierający EN, PL oraz stałe ID. Markdown i wielowierszowy tekst są kodowane jako JSON.
2. Wklej prompt do ChatGPT, wygeneruj osobne ilustracje i ZIP z `mapping.md` w głównym katalogu. Wymagany jest dokładnie jeden blok JSON: `{"version":1,"images":[{"id":"UUID","file":"images/rysunek.png"}]}`. Nazwy plików wybiera generator. Zestaw i styl są zapisywane lokalnie dla konta; **Resume illustrations** pozwala wrócić po zamknięciu okna lub odświeżeniu, również bez zaznaczonych fiszek. Przeglądarka musi pozwalać na localStorage. Plików ZIP i obrazów nie zapisujemy w localStorage.
3. Przeciągnij ZIP na widoczne pole importu lub kliknij je, aby wybrać plik, i sprawdź podgląd. Pole podświetla się podczas przeciągania; przyjmuje jeden ZIP naraz i jest zablokowane podczas przetwarzania. Domyślnie istniejące obrazy oraz frazy ze zmienioną treścią są pomijane. Można jawnie włączyć ich import. Brakujące lub usunięte frazy są oznaczone. Kliknij **Import**.

ZIP do **100 MiB**, więc paczka 50 MB mieści się w limicie. Archiwum jest rozpakowywane w przeglądarce i **nie jest wysyłane na serwer**. Limity rozpakowania: 30 MiB na obraz, 256 KiB na manifest, 250 MiB łącznie i 1000 wpisów archiwum. Obsługiwane są PNG, JPEG i WebP. Obrazy są kolejno zmniejszane do maksymalnie 1600 × 1600 bez powiększania i kompresowane do WebP z jakością 82. Przeglądarki bez kodera WebP mogą zwrócić PNG; backend ponownie sprawdza obraz i zapisuje WebP. Każdy wysyłany obraz musi zmieścić się w 5 MiB; backend ponownie ogranicza obraz do 25 megapikseli i stosuje dotychczasowe przetwarzanie.

Uploady są sekwencyjne, a wynik każdej fiszki jest widoczny osobno. Import może zakończyć się częściowym sukcesem; zapisane obrazy pozostają. Po błędzie wybierz ZIP ponownie, aby odświeżyć podgląd i ponowić import. Aktualizacja frazy po otwarciu podglądu powoduje konflikt zamiast nadpisania nowej zmiany. ID spoza eksportowanego zestawu, powtórzone przypisania i niebezpieczne ścieżki są odrzucane.

**Nginx:** wystarcza `client_max_body_size 6m;`, jak dla pojedynczych uploadów. Nie trzeba zwiększać go do 50 ani 100 MB, ponieważ ZIP pozostaje lokalny. Jeśli serwer nadal ma domyślny limit 1 MiB, zastosuj opisaną niżej zmianę i przeładuj Nginx. Import nie zmienia konfiguracji serwera automatycznie.

W oknie Learning hint wybierz Edit image. Wybierz plik lub wklej obraz przez Ctrl+V, sprawdź podgląd i kliknij Save. Zamknięcie okna przed zapisem nie wysyła pliku. Remove image przygotowuje usunięcie, które trzeba zatwierdzić przyciskiem Save.

Obsługiwane formaty wejściowe to JPEG, PNG i WebP, maksymalnie 5 MiB i 25 milionów pikseli. Backend sprawdza rzeczywistą zawartość pliku, koryguje orientację, zmniejsza do maksymalnie 1600 × 1600 px bez powiększania i zapisuje WebP z jakością 82. Metadane oryginału nie są zachowywane. Rozmiar wynikowy zależy od obrazu.

## Katalogi i dostęp

### Szybsze ładowanie podczas nauki

Flashcards i trening notatnika pobierają prywatny obraz bieżącej fiszki już podczas czytania pytania. Obraz pozostaje ukryty do sprawdzenia odpowiedzi. Prefetch i wyświetlenie współdzielą jedno żądanie, również gdy odpowiedź zostanie odsłonięta przed zakończeniem pobierania. Błąd pobierania w tle nie przerywa nauki; wyświetlenie może ponowić próbę.

Pobrane obrazy są przechowywane wyłącznie w pamięci bieżącej strony: maksymalnie 32 pliki i 32 MiB, do 10 minut. Najdawniej używane wpisy są usuwane po przekroczeniu limitów. Cache jest izolowany tokenem sesji, czyszczony przy wylogowaniu i znika po przeładowaniu strony. Nie zapisujemy zdjęć w localStorage, IndexedDB ani publicznym cache HTTP. Podmiana obrazu tworzy nowy URL, więc kolejny odczyt pobiera nową wersję. Adresy Blob używane do wyświetlania są zwalniane przy zamknięciu widoku obrazu.

Autoryzacja i nagłówek API `Cache-Control: private, no-store` pozostają bez zmian. Nginx nie wymaga dodatkowej konfiguracji.

```text
/srv/phrase-follower/uploads/            # katalog na Droplecie
  {userId}/
    {phraseId}/
      {losowyUUID}.webp
```

Docker montuje ten katalog pod `/app/storage/uploads`. Ścieżkę wewnętrzną określa `UPLOADS_DIR`, a katalog hosta opcjonalne `UPLOADS_HOST_DIR` w pliku `.env` obok Compose. Lokalnie domyślny katalog to `storage/uploads`, wyłączony z Git i kontekstu budowania Dockera.

Nazwy tworzy backend; oryginalna nazwa pliku nie jest używana. Katalog nie jest publicznym katalogiem statycznym. POST `/api/phrases/{phraseId}/image` wymaga tokenu i własności frazy. GET `/api/phrase-images/{phraseId}/{UUID}.webp` również sprawdza token, właściciela i aktualne powiązanie w bazie. Frontend pobiera obraz z nagłówkiem Authorization i wyświetla lokalny adres Blob. Tokeny nie trafiają do adresów URL. Odpowiedzi z obrazami mają `Cache-Control: private, no-store`.

Nowy plik powstaje przed zmianą powiązania w bazie; poprzedni usuwany jest po jej powodzeniu. Nieudana aktualizacja uploadu usuwa nowy plik. Równoczesne uploady sprawdzają poprzednią wartość, aby nie nadpisywać zmian bez ostrzeżenia. Zastąpienie zdjęcia linkiem, usunięcie zdjęcia, frazy lub notatnika sprząta powiązane pliki. Puste katalogi mogą pozostać.

Awaria procesu między zapisem pliku i aktualizacją bazy lub błąd kasowania może pozostawić plik bez powiązania. Takie pliki wymagają okresowego audytu względem bazy; automatyczne sprzątanie i limit przestrzeni na użytkownika nie są częścią tej wersji. Nie należy ręcznie usuwać plików aktualnie wskazywanych przez bazę.

## Przygotowanie Dropleta

Otwórz DigitalOcean, wybierz Droplet i Launch Droplet Console albo połącz się przez SSH. Poniższe polecenia wykonuj na serwerze Linux, nie w lokalnym PowerShellu.

Sprawdź miejsce i utwórz katalog:

```sh
df -h /srv
sudo install -d -m 0700 -o root -g root /srv/phrase-follower/uploads
sudo ls -ld /srv/phrase-follower/uploads
```

Obecny Dockerfile uruchamia proces jako root, dlatego właściciel root i tryb 0700 pasują do obecnej konfiguracji zwykłego, rootful Dockera. Przy zmianie użytkownika kontenera lub użyciu rootless Docker trzeba dopasować UID/GID właściciela katalogu. Nie używaj chmod 777.

W repozytorium konfiguracja Compose już zawiera montowanie:

```yaml
volumes:
  - type: bind
    source: ${UPLOADS_HOST_DIR:-/srv/phrase-follower/uploads}
    target: /app/storage/uploads
    bind:
      create_host_path: false
```

Katalog musi istnieć przed uruchomieniem nowej konfiguracji. Workflow GitHub Actions automatycznie dostarcza `docker-compose.yml` z wdrażanego commita. Przed podmianą sprawdza składnię i pobiera obrazy; poprzedni plik zachowuje jako `docker-compose.yml.bak`. Plik `.env` pozostaje na serwerze i nadal dostarcza konfigurację środowiska. Po uruchomieniu workflow sprawdza zmienną `UPLOADS_DIR` i możliwość zapisu w katalogu. Przy ręcznym wdrażaniu trzeba samodzielnie skopiować aktualny Compose.

## Wdrożenie i sprawdzenie

1. Zastosuj migrację `supabase/migrations/20261122120000_allow_local_phrase_images.sql` w swoim procesie migracji Supabase. Wymaga wcześniejszej migracji dodającej `image_url`.
2. Zbuduj i opublikuj nowy obraz aplikacji w dotychczasowym procesie wdrażania.
3. W katalogu serwera zawierającym aktualny Compose i `.env` uruchom:

```sh
docker compose config --quiet
docker compose pull app
docker compose up -d app
docker compose exec app sh -c 'id; test -w /app/storage/uploads && echo uploads-writable'
docker inspect phrase-follower --format '{{json .Mounts}}'
```

Jeżeli przed aplikacją działa Nginx, dodaj `client_max_body_size 6m;` w odpowiednim bloku `server`, następnie wykonaj `sudo nginx -t` i `sudo systemctl reload nginx`. Limit API pozostaje 5 MiB. Nie dodawaj publicznego aliasu Nginx do katalogu uploads.

Dla konfiguracji z instrukcji Dropleta otwórz `sudo nano /etc/nginx/sites-available/phrase-follower` i dodaj tę dyrektywę w bloku HTTPS (`listen 443`). Zapisz plik i wykonaj:

```sh
sudo nginx -t && sudo systemctl reload nginx
```

Domyślny limit Nginx wynosi 1 MiB. Jeśli proxy odrzuca upload błędem HTTP 413, żądanie nie dociera do aplikacji i może nie pojawić się w logach Dockera. Sprawdź `sudo tail -n 30 /var/log/nginx/phrase-follower-error.log`. Ustawienie limitu nie wyłącza walidacji 5 MiB w API. Konfiguracja Nginx pozostaje na serwerze; workflow jej nie nadpisuje. [Dokumentacja client_max_body_size](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size).

Komunikat `Image storage is not configured` oznacza brak `UPLOADS_DIR` w uruchomionym kontenerze. Workflow dostarcza teraz tę zmienną i montowanie przez aktualny Compose. Po udanym wdrożeniu powtórz zapis zdjęcia; w razie problemu sprawdź `docker inspect phrase-follower --format '{{json .Mounts}}'` i powyższe polecenia weryfikujące katalog.

Po wdrożeniu wklej zdjęcie, zapisz, odśwież stronę i sprawdź wyświetlanie po odsłonięciu odpowiedzi. Następnie wykonaj `docker compose up -d --force-recreate app` i ponownie sprawdź zdjęcie. Sprawdź też podmianę, usunięcie oraz brak dostępu z drugiego konta. Żądanie GET bez tokenu powinno zwracać 401.

## Backup i kontrola miejsca

Montowanie chroni przed utratą plików przy odtworzeniu kontenera. Nie chroni przed utratą Dropleta. Kopię katalogu należy przechowywać poza tym serwerem, razem z odpowiednio zabezpieczoną kopią bazy Supabase. Baza i pliki muszą pochodzić ze spójnego momentu; na czas ręcznej kopii można zatrzymać aplikację.

Przykład ręcznej kopii, uruchamiany w katalogu Compose:

```sh
sudo install -d -m 0700 /var/backups/phrase-follower
docker compose stop app
sudo tar -C /srv/phrase-follower -czf /var/backups/phrase-follower/uploads-$(date +%F-%H%M%S).tar.gz uploads
sudo chmod 0600 /var/backups/phrase-follower/uploads-*.tar.gz
docker compose start app
```

Jeśli archiwizacja się nie powiedzie, uruchom aplikację ponownie poleceniem `docker compose start app`. Archiwum lokalne trzeba skopiować poza Dropleta i ustalić retencję, aby same kopie nie zapełniły dysku. Przy odtwarzaniu zatrzymaj aplikację, odtwórz bazę i katalog z właściwymi uprawnieniami, a potem uruchom usługę i sprawdź obrazy.

Do kontroli wykorzystania miejsca:

```sh
df -h /srv/phrase-follower/uploads
sudo du -sh /srv/phrase-follower/uploads
```

Przy większej liczbie użytkowników można przenieść katalog na dodatkowy DigitalOcean Volume albo zastąpić zapis usługą Spaces. Obecna implementacja wymaga serwera Node i zapisywalnego dysku; nie działa jako upload na Cloudflare Pages. Repliki aplikacji muszą korzystać z tych samych plików.

## Zakres zabezpieczeń

Ta funkcja nie udostępnia katalogu publicznie i nie wykonuje przesłanych plików. Aplikacja zachowuje dotychczasowy sposób uruchamiania jako root wewnątrz kontenera. W razie wykorzystania błędu aplikacji daje to napastnikowi większe uprawnienia w kontenerze niż uruchomienie jej jako zwykły użytkownik. Osobno należy utrzymywać aktualizacje Ubuntu i obrazów, logowanie SSH kluczem, firewall oraz kopie zapasowe. Weryfikacja tych ustawień na konkretnym Droplecie nie jest częścią implementacji.

Kontrola rozmiaru pliku nie ogranicza łącznego wykorzystania przestrzeni ani liczby równoczesnych uploadów. Dla publicznej rejestracji należy dodać limity na użytkownika i ograniczanie liczby żądań. Na małym Droplecie warto obserwować również RAM podczas przetwarzania zdjęć.
