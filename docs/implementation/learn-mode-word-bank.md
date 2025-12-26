## Specyfikacja funkcjonalności: Tryb nauki — Word bank (kafelki)

### 1. Cel

Rozszerzyć tryb nauki EN↔PL o **alternatywny tryb odpowiedzi** typu „Duolingo”: użytkownik nie wpisuje tekstu, tylko **układa odpowiedź klikając kafelki (tokeny)** z puli.

Zakładamy:
- Działa dla **EN→PL i PL→EN** identycznie (zmienia się tylko język odpowiedzi docelowej).
- W MVP logika pozostaje **lokalna (frontend)** jak w `learn-mode.md` (bez zapisu w DB).
- Po poprawnym ułożeniu odpowiedzi przepływ jest **taki sam jak po wpisaniu i ENTER** (Correct/Not correct → Next / Finish round).

---

## 2. Miejsce w UI (Session settings)

Na ekranie `/notebooks/[id]/learn` (start sesji) w sekcji ustawień dodaj:

- **Tryb odpowiedzi (Answer input mode)**:
  - **Text input** (obecny, domyślny)
  - **Word bank (kafelki)** (nowy)

Zasady kompatybilności:
- Tryby „Exact match / Contains mode” z `learn-mode.md` dotyczą **Text input**.
- Dla **Word bank**:
  - Ocena odpowiedzi jest zawsze „**exact**” po złożeniu pełnej frazy (po normalizacji).
  - „Contains mode” jest **wyłączony/ukryty** w UI (nie ma sensu w układaniu tokenów).

---

## 3. UI karty w trybie Word bank

Stan karty pozostaje dwuetapowy jak w `learn-mode.md`:
- STAN A: _Before check_ (układanie)
- STAN B: _After check_ (feedback + next)

### 3.1. Elementy w stanie _Before check_

- **Prompt**: bez zmian (EN→PL pokazuje EN, PL→EN pokazuje PL).
- **Word pool**: lista kafelków (tokenów) w ramkach, styl jak w trybie odtwarzania.
  - Kafelki są **klikalne**.
  - Kafelki mogą być w puli więcej niż raz (jeśli token występuje wielokrotnie w poprawnej odpowiedzi).
  - Kolejność kafelków w puli:
    - Docelowo losowa (żeby nie podpowiadać).
    - W MVP: można losować deterministycznie per-karta (np. prosty shuffle).
- **Answer area / Results**: obszar z wybranymi kafelkami (ułożona odpowiedź).
  - Kafelki układają się **w kolejności klikania**.
  - Kliknięcie kafelka w Results:
    - usuwa go z odpowiedzi,
    - zwraca ten token do puli (do Word pool).

### 3.2. Sprawdzanie odpowiedzi (auto-check)

- Sprawdzenie odpowiedzi odbywa się **automatycznie** w momencie, gdy:
  - liczba wybranych tokenów == liczbie tokenów w poprawnej odpowiedzi (po tokenizacji).
- UI może opcjonalnie pokazać przycisk „Check” jako fallback, ale **logika docelowa to auto-check**.

### 3.3. Elementy w stanie _After check_ (feedback)

Po auto-check:
- Zablokuj edycję:
  - Word pool i Results stają się nieklikalne (albo cały stan przechodzi do feedbacku).
- Pokaż wynik:
  - `Correct` / `Not correct` (jak w `learn-mode.md`)
- Pokaż porównanie:
  - „Twoja odpowiedź” (złożona z tokenów),
  - „Poprawna odpowiedź”,
  - diff wizualny jak w `learn-mode.md`.
- ENTER / przycisk „Next” działa identycznie jak dotychczas.

---

## 4. Tokenizacja (jak dzielimy frazę na kafelki)

W tym trybie odpowiedź i poprawna fraza są porównywane jako **sekwencja tokenów** złożona w string.

### 4.1. Reguły MVP

- Tokeny są generowane z frazy docelowej:
  - podstawowy podział po spacji,
  - zachowuj typowe skróty jako całość (np. `don't`, `I'm`),
  - końcową interpunkcję `.?!…`:
    - albo ignoruj (jak w normalizacji),
    - albo trzymaj jako osobny token — ale tylko jeśli UI ją ma umożliwić klikaniem.

Rekomendacja MVP: **ignorować końcową interpunkcję** (spójnie z normalizacją).

### 4.2. Duplikaty tokenów

Jeśli token w poprawnej odpowiedzi występuje N razy, w Word pool powinien wystąpić **N razy** (jako oddzielne kafelki).

---

## 5. Generowanie Word pool (poprawne tokeny + distractory)

Word pool zawiera:
- wszystkie poprawne tokeny (z duplikatami),
- dodatkowe tokeny (distractors) dobrane heurystycznie i z innych fraz.

### 5.1. Liczba distractorów

- Jeśli poprawna odpowiedź ma **1–2 tokeny**:
  - dodaj tak, by użytkownik widział **~4 dodatkowe opcje** (czyli: 1–2 poprawne + ~4 błędne).
- Jeśli odpowiedź jest dłuższa:
  - dodaj **2–3 distractory**.

Uwaga: Jeśli notatnik jest bardzo mały i brakuje materiału na distractory, dozwolone jest:
- wziąć tokeny z globalnej, małej listy (predefiniowanej) dla danej klasy (patrz heurystyki),
- albo zmniejszyć liczbę distractorów.

### 5.2. Heurystyki „podobnych” distractorów (priorytet)

Jeśli w poprawnej odpowiedzi występuje token z kategorii, dodaj „bliskie” alternatywy:

- Przedimki:
  - `the` → dodaj `a`, `an`
  - `a` → dodaj `the`, `an`
  - `an` → dodaj `a`, `the`
- Przyimki miejsca/czasu (MVP heurystycznie):
  - `at` → dodaj `in`, `on`
  - `in` → dodaj `at`, `on`
  - `on` → dodaj `in`, `at`

Można rozszerzać później o:
- `is/are/was/were`, `do/does/did`, `some/any`, itd.

### 5.3. Distractory z innych fraz w notatniku

Gdy potrzeba więcej distractorów:
- wybierz tokeny z innych fraz w tym samym notatniku,
- preferuj:
  - tokeny o podobnej długości,
  - tokeny „częste” w tym notatniku,
  - tokeny z tej samej kategorii (jeśli da się wykryć).

Filtry:
- nie dodawaj tokenów już obecnych w puli (chyba że celowo jako distractor-duplikat),
- nie dodawaj pustych tokenów.

### 5.4. Mieszanie puli

Po zbudowaniu puli:
- przetasuj kolejność kafelków, aby nie grupować poprawnych słów.

---

## 6. Logika poprawności (jak oceniamy ułożoną odpowiedź)

1) Z Results bierzemy wybraną sekwencję tokenów i składamy w string:
- join tokenów pojedynczą spacją.

2) Poprawną odpowiedź składamy analogicznie:
- join tokenów poprawnych pojedynczą spacją,
- (jeśli ignorujemy końcową interpunkcję, usuń ją tu konsekwentnie).

3) Porównanie:
- zastosuj tę samą normalizację co w `learn-mode.md` (case, spacje, końcowa interpunkcja),
- warunek: `normalizedUser === normalizedCorrect`.

---

## 7. Interakcje klawiaturowe (MVP)

- **ENTER**:
  - jeśli jeszcze nie ma wyniku (Before check):
    - jeśli odpowiedź jest kompletna (długość tokenów) → przejdź do check (w praktyce i tak auto-check),
    - jeśli niekompletna → brak akcji (lub lekki hint).
  - jeśli jest wynik (After check): Next / Finish round (jak w `learn-mode.md`).

Opcjonalnie (nice-to-have):
- **Backspace**: usuń ostatni wybrany token z Results i zwróć do puli.

---

## 8. Edge cases

- **Brak fraz w notatniku**: bez zmian (blokada startu).
- **Bardzo krótka odpowiedź (1 token)**:
  - zawsze staraj się dodać ~4 distractory,
  - w razie braku: dozwolone fallbacki (heurystyki / mniejsza liczba).
- **Duplikaty tokenów** w poprawnej odpowiedzi:
  - muszą być obsłużone (w puli N kopii).
- **Tokeny typu „the,” / „word.”**:
  - rekomendacja: usuń końcową interpunkcję na etapie tokenizacji/normalizacji, aby nie wymagać klikania „.”.
- **Polskie znaki/diakrytyki**:
  - traktuj jak normalny tekst (bez odgórnego „strip accents” w MVP).

---

## 9. Co to zmienia w istniejącej specyfikacji (`learn-mode.md`)

Do `learn-mode.md` nie trzeba mieszać dużych sekcji. Wystarczy:
- w sekcji „Ekran startowy sesji nauki” dopisać nową opcję „Tryb odpowiedzi: Text input / Word bank”
- oraz dopisać referencję: „Szczegóły Word bank: `docs/implementation/learn-mode-word-bank.md`”.


