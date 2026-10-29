# Dokument wymagań produktu (PRD) - Phrase Follower (MVP)

## 1. Przegląd produktu

Cel: ułatwić naukę angielskich fraz przez sekwencyjne odsłuchy EN → PL z tanim TTS Google.
Zakres MVP: prywatne notatniki z frazami EN/PL, import `EN ::: PL`, konfiguracja lektorów EN3 + PL1 per użytkownik, generowanie i przechowywanie audio per fraza × lektor, odtwarzanie w przeglądarce, dark mode.

## 2. Problem użytkownika

Uczący się B1/B2 potrzebują powtarzalnej sekwencji odsłuchów z wieloma głosami EN oraz prostego przepływu: import → generacja → odsłuch. Ogólne narzędzia nie oferują kombinacji multi-voice EN i płynnego EN→PL w jednym miejscu przy niskim koszcie TTS.

## 3. Wymagania funkcjonalne

3.1 Notatniki

1. Tworzenie notatnika przez import; zmiana nazwy; usuwanie notatnika (usuwa powiązane MP3).
2. W notatniku: dodawanie pojedynczych fraz, zmiana kolejności, usuwanie fraz (usuwa także MP3).
3. Widok tabelaryczny fraz.
4. Notatniki prywatne per użytkownik (logowanie wymagane).

3.2 Import 5) Format pliku: linia-po-linii `EN zdanie ::: PL zdanie`. 6) Walidacja: pojedynczy separator, niepustość EN/PL; limity: ≤200 fraz/notatnik, ≤2000 znaków/fraza.
6.1) Użytkownik może utworzyć maksymalnie 500 notatników. 7) Normalizacja wejścia: cudzysłowy typograficzne, znaki zero-width, podwójne spacje, podstawowa normalizacja znaków problematycznych. 8) Raport importu: lista odrzuconych linii z powodem.

3.3 TTS i lektorzy 9) Klucz Google TTS per użytkownik: zapis w ustawieniach; test walidacyjny przy zapisie; brak ekspozycji klucza do klienta. 10) Lektorzy: EN3 w ustalonej kolejności + PL1; brak duplikatów w obrębie języka; kolejność EN wyznacza odtwarzanie.

3.4 Generowanie audio 11) Przycisk Generate audio w notatniku; generuje MP3 per fraza × lektor (EN1, EN2, EN3, PL) z parametrami MP3 22.05 kHz / 64 kbps mono. 12) Pełny rebuild całego notatnika; po sukcesie stare MP3 są usuwane; błędne segmenty oznaczane jako failed; prosty komunikat globalny błędu.

3.5 Odtwarzanie 13) Sekwencja: EN1 → EN2 → EN3 → PL; pauza 800 ms między segmentami i 800 ms między frazami; auto-advance po zakończeniu PL i pauzie. 14) Sterowanie: Play/Pause, przewijanie w obrębie frazy, prędkości 0.75/0.9/1.0/1.25.

3.6 UI i komunikaty 17) Dark mode only. 18) Strony: lista notatników; import; notatnik (tabela fraz, Generate); player; ustawienia TTS. 19) Komunikaty: import – lista odrzuconych; generate – „Nie udało się wygenerować audio. Spróbuj ponownie.”

## 4. Granice produktu

4.1 Poza zakresem MVP

1. PWA/offline; hotkeys; hover-jump; tłumaczenia EN↔PL; publiczne API; SSO; telemetria; ręczna edycja synchronizacji słów; eksport ZIP; prefetching.

4.2 Założenia i ograniczenia 2) Aplikacja online-only; single-tenant; lokalne katalogi; sekrety TTS po stronie serwera. 3) Struktura plików (informacyjnie): storage/audio/{notebookId}/{phraseId}/{voice}.mp3; storage/meta/... 4) Usuwanie: hard delete MP3; brak retry w generowaniu; regeneracja wyłącznie ręcznie.

4.3 Plany na przyszłość 5) Eksport ZIP: {notebook}.zip; wewnątrz pliki = połączone EN(1..3) → PL z pauzami 800 ms; nazwy {dni*od_2025-01-01}*{NNN}\_{Fraza_do_150}.mp3; auto-clean po pobraniu i po 24 h; limit ZIP < 30 MB. 6) Prefetching: pobranie wszystkich segmentów bieżącej frazy równolegle + preload pierwszego segmentu następnej; limit równoległości 6; anulowanie pobrań przy zmianie frazy.

## 5. Historyjki użytkowników

UC-01 Logowanie i prywatny dostęp
Opis: Jako zalogowany użytkownik chcę widzieć wyłącznie własne notatniki i pliki.
Kryteria akceptacji:

- Given user niezalogowany, when otwiera aplikację, then widzi ekran logowania.
- Given user A zalogowany, when otwiera URL zasobu usera B, then dostaje 404/403 bez metadanych.
- Given wylogowanie lub wygaśnięcie sesji, when odświeżam widok, then następuje przekierowanie do logowania.
- Logowanie odbywają się na dedykowanej stronie.
- Logowanie wymaga podania adresu email i hasła.
- Użytkownik może się wylogować z systemu poprzez przycisk w prawym górnym rogu w głównym @Layout.astro.
- Wsparcie dla trybu developerskiego: w NODE*ENV=development działa endpoint /api/dev/jwt, który zwraca krótkotrwały token dev* dla stałego DEFAULT_USER_ID, zapisywany w localStorage i przekazywany jako Authorization: Bearer.

UC-02 Konfiguracja klucza Google TTS
Opis: Jako użytkownik chcę zapisać swój klucz TTS po teście walidacyjnym.
Kryteria akceptacji:

- Poprawny klucz po teście zostaje zapisany; UI oznacza stan „skonfigurowano”.
- Błędny klucz → komunikat błędu i brak zapisu.
- Inspekcja sieci nie ujawnia klucza po stronie klienta.

UC-03 Konfiguracja lektorów EN3 + PL1
Opis: Jako użytkownik chcę ustawić voice IDs i kolejność EN bez duplikatów.
Kryteria akceptacji:

- Walidacja niedopuszcza duplikatów w obrębie języka.
- Zapisana kolejność EN determinuje sekwencję odtwarzania EN1→EN2→EN3→PL.

UC-04 Import notatnika z pliku
Opis: Jako użytkownik chcę zaimportować plik `EN ::: PL` i otrzymać raport odrzuceń.
Kryteria akceptacji:

- Linie z wielokrotnym/niejednoznacznym separatorem lub pustą częścią są odrzucone z powodem.
- Po imporcie frazy są znormalizowane; limity: ≤200 fraz, ≤2000 znaków/fraza.

UC-05 Zarządzanie frazami w notatniku
Opis: Jako użytkownik chcę dodawać, przenosić i usuwać frazy.
Kryteria akceptacji:

- Dodanie wymaga niepustych EN/PL i spełnienia limitów.
- Zmiana kolejności widoczna w tabeli.
- Usunięcie frazy usuwa jej pliki MP3.

UC-06 Generowanie audio całego notatnika
Opis: Jako użytkownik chcę jednym kliknięciem wygenerować MP3 per fraza × lektor.
Kryteria akceptacji:

- Po sukcesie stare MP3 są usunięte; brak duplikatów dla notatnika.
- Błędne segmenty oznaczane jako failed; globalny komunikat „Nie udało się wygenerować audio. Spróbuj ponownie.” w razie niepowodzenia.

UC-07 Odtwarzanie EN1→EN2→EN3→PL
Opis: Jako użytkownik chcę odtwarzać frazę w sekwencji EN→PL z pauzami i auto-advance.
Kryteria akceptacji:

- Odtwarzanie: EN1 → EN2 → EN3 → PL; pauza 800 ms między segmentami i frazami.
- Po zakończeniu PL i 800 ms pauzy automatycznie startuje kolejna fraza.
- Zmiana prędkości 0.75/0.9/1.0/1.25 działa bez artefaktów.

UC-08 Spójne komunikaty błędów
Opis: Jako użytkownik chcę jasnych komunikatów w krytycznych miejscach.
Kryteria akceptacji:

- Import: lista odrzuconych z powodem.
- Generate: komunikat błędu z treścią „Nie udało się wygenerować audio. Spróbuj ponownie.”

## 6. Metryki sukcesu

1. Import: ≥95% poprawnie przetworzonych linii zgodnych ze wzorcem; 100% odrzutów z jasnym powodem.
2. Odtwarzanie: auto-advance ≤ 150 ms ponad zadaną pauzę 800 ms; brak słyszalnych przerw.
3. Generowanie: 0 duplikatów MP3 po regeneracjach dla notatnika; player pomija braki w manifeście.
4. Bezpieczeństwo: 0 przypadków dostępu cross-user w testach (403/404 bez wycieku metadanych); klucz TTS niewidoczny w kliencie w 100% żądań.
