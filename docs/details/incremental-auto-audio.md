# Incremental Auto Audio

## Podsumowanie do CR

Ta zmiana dodaje automatyczne generowanie audio tylko dla nowo dodanych fraz, bez uruchamiania pełnego rebuilda notatnika.

Zakres:

- dodanie pojedynczej frazy przez API notatnika
- append import do istniejącego notatnika

Kluczowe założenia:

- ręczny `Generate Audio` zostaje bez zmian i nadal robi pełny rebuild
- auto-audio działa tylko dla notatników, które mają już `current_build_id`
- nowe segmenty są dopisywane do istniejącego buildu
- nie zmieniamy `current_build_id`
- nie dezaktywujemy istniejących segmentów
- brak konfiguracji TTS/voices albo aktywny rebuild nie blokuje zapisu fraz, tylko pomija auto-generowanie

Walidacja:

- `npm run lint` przechodzi
- `npm run test:run` przechodzi: `140` testów
- `npm run build` przechodzi
- dodany test symulacyjny incremental flow:
  - skip dla notatnika bez aktywnego buildu
  - generowanie tylko dla nowych fraz w notatniku z aktywnym buildem

Wpływ na produkcję:

- brak zmian w schemacie bazy danych
- brak migracji
- standardowy deploy aplikacji

## Cel

Dodać automatyczne generowanie audio tylko dla nowo dodanych fraz, bez uruchamiania pełnego rebuilda notatnika.

## Zakres

Auto-generowanie uruchamia się tylko w dwóch przypadkach:

- po dodaniu pojedynczej frazy przez `POST /api/notebooks/:notebookId/phrases`
- po imporcie do istniejącego notatnika przez `POST /api/notebooks/import` z `notebook_id`

Poza zakresem:

- edycja istniejącej frazy
- zmiana konfiguracji voice slots
- tworzenie nowego notatnika przy imporcie
- zastępowanie ręcznego `Generate Audio`

## Ustalenia produktowe

- Ręczny `Generate Audio` zostaje bez zmian i nadal robi pełny rebuild.
- Auto-audio działa tylko wtedy, gdy notatnik ma już `current_build_id`.
- Jeśli TTS albo voices nie są skonfigurowane, zapis fraz nadal kończy się sukcesem, a auto-audio jest pomijane.
- Jeśli dla notatnika jest aktywny job `queued` lub `running`, auto-audio jest pomijane.
- Generowanie obejmuje tylko przekazane, nowo utworzone `phrase_id`.
- Błędy pojedynczych segmentów zapisują `audio_segments.status = failed`, bez cofania całej operacji zapisu fraz.

## Podejście techniczne

Dodany został osobny helper `src/lib/incremental-audio.ts`.

Jego odpowiedzialność:

- sprawdzić, czy notatnik ma aktywny build
- sprawdzić, czy nie trwa pełny rebuild
- sprawdzić, czy user ma skonfigurowane TTS i voice slots
- pobrać tylko wskazane nowe frazy
- sprawdzić, czy segmenty dla tych fraz i bieżącego buildu już nie istnieją
- wygenerować brakujące MP3
- dopisać nowe rekordy do istniejącego `build_id` z `is_active = true`

## Dlaczego bez nowego buildu

Obecny pipeline pełnego generowania:

- tworzy nowy `build`
- generuje segmenty dla całego notatnika
- dezaktywuje stare segmenty
- ustawia nowy `current_build_id`

To zachowanie jest poprawne dla ręcznego rebuilda, ale zbyt inwazyjne dla dopisywania nowych fraz. Incremental auto-audio nie zmienia `current_build_id` i nie dezaktywuje istniejących segmentów.

## Ograniczenia

- W środowisku request/worker uruchomienie jest best-effort, analogicznie do obecnego startu joba w tle.
- Jeśli user edytuje istniejącą frazę, stare audio zostaje do czasu ręcznego rebuilda.
- Jeśli notatnik nie ma jeszcze audio, nowe frazy też nie dostaną auto-audio, dopóki user nie wykona pierwszego `Generate Audio`.

## Szacowanie pracochłonności

- wariant minimalny i bezpieczny: `6-10h`
- wariant z pełnym job trackingiem dla incremental flow i rozbudowanym UX: `1.5-2.5 dnia`
- wsparcie auto-regeneracji przy edycji istniejących fraz lub zmianie voice configu: dodatkowo `0.5-1 dnia`
