# Story Live Audio Streaming (beta)

## Cel

Skrócić czas oczekiwania na pierwsze słyszalne audio dla AI Story. Nowy wariant ma zacząć odtwarzanie, gdy Google Chirp 3: HD zwróci pierwsze porcje dźwięku, zamiast czekać na pełne wygenerowanie i zapis MP3.

Nie zastępuje to obecnego odtwarzania story. Jest to osobna, eksperymentalna ścieżka.

## Stan obecny

Obecny endpoint `POST /api/stories/audio`:

1. czyta całą angielską część story;
2. wywołuje synchroniczne Google Cloud TTS z formatem MP3;
3. czeka na kompletne audio;
4. zapisuje MP3 w Supabase Storage;
5. zapisuje rekord w `story_audio_cache` i zwraca podpisany URL.

Ten cache pozostaje bez zmian. Cache hit ma nadal używać obecnego, gotowego pliku MP3, ponieważ jest to najszybsza ścieżka ponownego odtworzenia.

## Zakres beta

- Dodać drugi przycisk/głośnik w modalu story, wyraźnie oznaczony jako `Live audio (beta)`.
- Obecny przycisk `Play English story` i endpoint MP3 pozostają niezmienione.
- Beta obejmuje kompletną ścieżkę: backend, odtwarzanie w UI, anulowanie, obsługę błędów i testy.
- Nowy przycisk działa niezależnie obok obecnego głośnika. Uruchomienie jednego wariantu zatrzymuje drugi, aby oba nagrania nie grały jednocześnie.
- Nowy endpoint korzysta z Google Cloud Text-to-Speech `StreamingSynthesize` oraz głosu Chirp 3: HD wybranego w ustawieniach story.
- Backend przekazuje porcje audio do przeglądarki, a przeglądarka odtwarza je po zebraniu krótkiego bufora.
- Streaming działa tylko dla angielskiej części story, tak jak obecne audio.
- W razie błędu, anulowania lub braku obsługi w przeglądarce UI pokazuje czytelny błąd z bezpiecznymi detalami technicznymi. Nie uruchamia automatycznie MP3 i nie psuje zwykłego odtwarzania MP3.
- Detale błędu nie mogą zawierać klucza TTS, danych uwierzytelniających ani innych sekretów.

## Architektura

Wersja beta ma działać w obecnej aplikacji Astro/Node, uruchomionej w tym samym kontenerze Docker na DigitalOcean. Nie wymaga Cloud Run, dodatkowego kontenera ani osobnego deployu.

```text
Story modal (drugi głośnik)
  -> /api/stories/audio/stream
  -> Google Chirp 3 streaming
  -> porcje audio
  -> bufor + odtwarzanie w przeglądarce
```

Backend używa istniejącego, zaszyfrowanego klucza TTS użytkownika z ustawień. Nie wolno wysyłać tego klucza do przeglądarki, logów ani repozytorium.

## Format audio i odtwarzanie

Streaming Chirp 3 nie zwraca MP3. Dostępne formaty to PCM, ALAW, MULAW i OGG Opus.

Beta używa streamingowego `audio_encoding=PCM`: surowego PCM 16-bit little-endian, mono, 24 kHz. Nie należy używać `LINEAR16`, ponieważ w Google Cloud TTS oznacza ono wariant opakowany nagłówkiem WAV i nie jest obsługiwane przez `StreamingAudioConfig`. Backend opakowuje porcje PCM w prosty protokół ramek aplikacyjnych, który rozróżnia audio, bezpieczny błąd i koniec streamu. Przeglądarka odtwarza próbki przez Web Audio API po zebraniu około 250 ms bufora. Rozwiązanie nie zależy od obsługi porcjowanego kontenera OGG przez `MediaSource`.

Na iOS wszystkie przeglądarki korzystają z WebKit. Pierwszy tap `Live audio (beta)` synchronicznie odblokowuje `AudioContext`, ustawia wspieraną sesję audio na `playback` i uruchamia zapętlony, cichy element audio na czas streamu. Zapobiega to cichemu pierwszemu odtworzeniu oraz przełączaniu sesji na przyciszony tryb po zablokowaniu ekranu. Po zatrzymaniu lub zamknięciu modala poprzedni typ sesji jest przywracany, a element podtrzymujący jest zwalniany.

Gdy przeglądarka odbierze kompletny PCM na iOS, opakowuje go lokalnie w WAV i płynnie przełącza odtwarzanie z Web Audio na natywny element audio od bieżącej pozycji. Dzięki temu odtwarzacz na zablokowanym ekranie pokazuje rzeczywisty czas nagrania i obsługuje przewijanie. Odtworzenie z krótkiego cache'a przeglądarkowego od razu korzysta z tego WAV.

Backend łączy się z `StreamingSynthesize` przez oficjalnego klienta Google Cloud i przekazuje istniejący klucz API wyłącznie jako dane uwierzytelniające gRPC. Jeżeli Google odrzuci klucz dla tej metody, klient otrzymuje bezpieczny kod `PERMISSION_DENIED` albo `UNAUTHENTICATED`; decyzja o dodaniu konta usługi pozostaje poza zakresem tej bety.

Przy cache hit endpoint zwraca JSON z podpisanym URL istniejącego MP3. Przy cache miss zwraca `application/x-story-live-audio` jako strumień ramek.

## Cache

### Serwer

- `story_audio_cache` oraz MP3 w Supabase Storage zostają.
- Beta najpierw sprawdza istniejący cache. Przy cache hit może użyć zwykłego MP3.
- Po udanym streamie można w kolejnej iteracji zapisać pełne audio do cache'a. Nie jest to warunek bety.
- Przerwany lub niekompletny stream nie jest cache'owany.

### Przeglądarka

Po odebraniu kompletnego streamu przeglądarka przechowuje surowe PCM przez 10 minut w pamięci bieżącej karty, maksymalnie dla trzech historii. Ponowne użycie `Live audio (beta)` dla tej samej treści nie wykonuje requestu do endpointu ani Google. Przerwany lub błędny stream nie jest zapisywany. Cache znika po odświeżeniu strony i jest czyszczony po zapisaniu ustawień story, dzięki czemu zmiana głosu lub tempa nie odtwarza starego wariantu.

## Kryteria akceptacji bety

1. Drugi głośnik jest widoczny tylko dla gotowego story i nie zmienia zachowania obecnego głośnika.
2. Przy cache miss audio zaczyna grać przed otrzymaniem całego nagrania.
3. Aktywny przycisk `Live audio (beta)` umożliwia zatrzymanie odtwarzania; zamknięcie modala działa również podczas łączenia i przerywa odtwarzanie, żądanie HTTP oraz połączenie z Google.
4. Klucz TTS nie trafia do klienta ani logów.
5. Zwykłe MP3 i obecny cache nadal działają.
6. Wynik jest sprawdzony przynajmniej w Chrome desktop i Chrome Android. Brak stabilnej obsługi w Safari kończy się bezpiecznym błędem w ścieżce beta; użytkownik może niezależnie użyć istniejącego przycisku MP3.

## Poza zakresem beta

- zastąpienie obecnego MP3 i cache'a;
- migracja na Cloud Run lub nowy kontener;
- trwały cache streamowanego audio;
- synchronizacja tekstu słowo-po-słowie;
- zmiana konfiguracji głosów lub ustawień story.

## Ryzyka i dalsze decyzje

- Google opisuje streaming jako funkcję Preview; należy uwzględnić fallback do MP3.
- Należy potwierdzić obsługę obecnego klucza API dla `StreamingSynthesize`. Jeśli nie zadziała, decyzja o koncie usługi będzie osobnym krokiem.
- Jeśli odtwarzanie OGG Opus porcjami okaże się niestabilne, wybieramy PCM/Web Audio albo kończymy beta feature i pozostawiamy zwykłe MP3.
