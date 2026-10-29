# Import pliku `EN ::: PL`

## Format

- Każda linia: `EN zdanie ::: PL zdanie`
- Separator dokładnie `:::` (spacje wokół dopuszczalne po trim).

## Walidacja

Odrzuć linię, jeśli:

- brak separatora lub jest wiele separatorów,
- EN lub PL puste po trim,
- przekroczono limit: ≤200 fraz/notatnik, ≤2000 znaków/fraza.

Raport: pokaż tylko odrzucone linie z numerem i powodem.

## Normalizacja (spójna z tokenization.md)

- NIE usuwamy i NIE zamieniamy „-" ani „—".
- Redukujemy ≥2 spacje do pojedynczej (pojedyncze spacje zostają).
- Usuwamy zero-width, znaki sterujące; zamieniamy „inteligentne" cudzysłowy na proste; trim.

## Dane wyjściowe

- Lista zaakceptowanych par EN/PL do utworzenia notatnika.
- Raport odrzuceń: `[{ lineNumber, reason, preview }]`.

## UI

- Po imporcie pokazujemy tylko odrzucone pozycje z powodem (bez rozbudowanych statystyk).
