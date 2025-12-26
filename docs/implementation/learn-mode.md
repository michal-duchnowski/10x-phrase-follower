## Specyfikacja funkcjonalności: Tryb nauki (EN↔PL)

### 1. Wstęp

Celem trybu nauki jest wsparcie **memorization / recall** fraz EN↔PL na bazie istniejących notatników. Użytkownik pracuje na pojedynczych frazach, wpisuje tłumaczenie, otrzymuje informację zwrotną (poprawne/niepoprawne) oraz może korzystać z audio (jeśli istnieje). Ten dokument jest wejściem do implementacji (frontend + backend), bez decyzji technologicznych w kodzie.

Grupa docelowa na start: **właściciel aplikacji (B2/C1)** – zaawansowany użytkownik, testujący MVP na własnych deckach.

---

## 2. Zakres funkcjonalny

- **Nowy tryb nauki** przypięty do notatnika:
  - Osobna trasa: `/notebooks/[id]/learn`.
  - Wejście do trybu z widoku notatnika (np. przycisk “Tryb nauki”).
- **Kierunki nauki**:
  - EN→PL (pokazuj EN, użytkownik wpisuje PL).
  - PL→EN (pokazuj PL, użytkownik wpisuje EN).
  - Kierunek jest **stały dla danej sesji**, wybierany przed startem.
- **Jednostka nauki**:
  - Praca na **pojedynczej frazie** (karta).
  - Sesja obejmuje wszystkie frazy z danego notatnika, z opcją **shuffle**.
  - **Rundy**:
    - Runda 1: wszystkie frazy wybrane do sesji.
    - Kolejne rundy: tylko frazy, które w poprzedniej rundzie były błędne.
- **Audio w trybie nauki**:
  - EN→PL: automatycznie odtwarzane **EN** (po wejściu na kartę).
  - PL→EN: automatycznie odtwarzane **PL** (po wejściu na kartę).
  - Jeśli dla danego języka nie ma audio (missing/failed), karta nadal jest używana tekstowo, a audio jest oznaczone jako niedostępne.
- **Statystyki sesji**:
  - Liczenie poprawnych/niepoprawnych odpowiedzi **w obrębie bieżącej sesji**.
  - Pasek postępu: `aktualny indeks / liczba kart w bieżącej rundzie` (jedyna obowiązkowa statystyka widoczna zawsze).
  - Dodatkowe statystyki (Correct / Incorrect / Left) są opcjonalne, pasywne, umieszczone z dala od głównego zadania.
  - Po zakończeniu rundy: mini podsumowanie (np. `20/30 poprawnych, 10 do powtórki`).
  - Dane sesji **nie są zapisywane w DB** (na start – tylko w pamięci).

---

## 3. Przepływ użytkownika

### 3.1. Wejście do trybu nauki

- Użytkownik jest zalogowany i ma dostęp do notatnika `N`.
- Na widoku notatnika widzi przycisk/link **“Tryb nauki”**.
- Po kliknięciu przechodzi do `/notebooks/[id]/learn`.

### 3.2. Ekran startowy sesji nauki

Na `/notebooks/[id]/learn`:

- **Sekcja wyboru trybu**:
  - Kierunek:
    - Przełącznik: **EN→PL** / **PL→EN** (radio / segment control).
  - Kolejność:
    - Checkbox/przełącznik: **Shuffle** (domyślnie włączony).
  - Tryb odpowiedzi:
    - **Exact match** (domyślnie): wymaga pełnej, dokładnej odpowiedzi.
    - **Contains mode**: akceptuje odpowiedź, jeśli pasuje do dowolnego słowa w poprawnej odpowiedzi (np. dla "siniak stłuczenie sińce" akceptuje "siniak" lub "sińce").
    - (Opcjonalnie) **Word bank (kafelki)**: układanie odpowiedzi z puli tokenów (Duolingo-style). Szczegóły: `docs/implementation/learn-mode-word-bank.md`.
- Informacja o liczbie fraz w notatniku (np. `30 fraz w tym notatniku`).
- Przycisk: **“Start”**:
  - Tworzy listę fraz do rundy 1:
    - Jeśli shuffle = ON → pełne przetasowanie listy.
    - Jeśli shuffle = OFF → kolejność wg `position`.

### 3.3. Widok karty (pojedyncza fraza)

Po naciśnięciu **Start** użytkownik widzi **widok karty w jednym z dwóch stanów UI**.

#### 3.3.1. Elementy wspólne (obie stany)

- **Górny pasek**:
  - Nazwa notatnika.
  - Pasek postępu: `Karta X / Y w tej rundzie` (jedyna obowiązkowa statystyka widoczna zawsze).
  - Link "Powrót do notatnika".
- **Sekcja bodźca (prompt)**:
  - Jeśli EN→PL: wyświetlane jest `en_text` (z markdown, np. `__pogrubienia__`).
  - Jeśli PL→EN: wyświetlane jest `pl_text`.
  - Markdown renderowany (jak w tabeli fraz).
- **Audio**:
  - Automatyczne odtwarzanie **tylko raz** przy wejściu na kartę (w stanie _Before check_):
    - EN→PL: EN (angielski slot).
    - PL→EN: PL (polski slot).
  - Audio nie odtwarza się ponownie po naciśnięciu klawiszy.
  - Jeśli w manifeście/audio brak segmentu dla właściwego języka, sesja działa normalnie tekstowo.
- **Dodatkowe statystyki sesji (opcjonalne)**:
  - Małe, pasywne liczniki `Correct / Incorrect / Left`.
  - Umieszczone **z dala od inputu i głównego promptu** (np. w górnym pasku lub bocznym pasku), tak aby **nie konkurowały z zadaniem**.

#### 3.3.2. STAN A — _Before check_ (odpowiadanie)

Widoczne:

- **Prompt** (jak wyżej).
- **Pole odpowiedzi (input/textarea)**:
  - EN→PL: użytkownik wpisuje polskie tłumaczenie.
  - PL→EN: użytkownik wpisuje angielskie tłumaczenie.
  - Pole jest **edytowalne**.
- **Przycisk "Sprawdź odpowiedź"**:
  - Funkcjonalny odpowiednik ENTER **przed** sprawdzeniem.
  - Nazwa przycisku nie zawiera "(Enter)" – skrót klawiaturowy jest opisany w podpowiedzi.
- **Przycisk "Skip"** (opcjonalny, tylko w tym stanie):
  - Pomija kartę bez zaliczenia na poprawną / błędną.
  - Karta skipnięta **nie jest traktowana jako błędna** (nie dodajemy do listy "błędnych").

Ukryte w tym stanie:

- Wynik (`Correct` / `Not correct`).
- Poprawna odpowiedź.
- Diff tekstowy.
- Statystyki correct / incorrect w centralnej części widoku.
- Normalizowane odpowiedzi (`normalizedUser`, `normalizedCorrect`).
- Przyciski "Next" / "Previous".

#### 3.3.3. STAN B — _After check_ (feedback)

Widoczne:

- **Wynik globalny**:
  - `Correct ✅` lub `Not correct ❌` (krótki, jednoznaczny komunikat).
- **Twoja odpowiedź**:
  - Prezentowana jako **readonly** (bez możliwości edycji).
  - Z diffem pokazującym różnice względem poprawnej odpowiedzi.
- **Poprawna odpowiedź**:
  - Z diffem pokazującym różnice względem odpowiedzi użytkownika.
- **Przycisk "Następna karta"** (lub "Finish round" dla ostatniej karty):
  - Funkcjonalny odpowiednik ENTER **po** sprawdzeniu.
  - Nazwa przycisku nie zawiera "(Enter)" – skrót klawiaturowy jest opisany w podpowiedzi.

Ukryte w tym stanie:

- Edytowalne pole odpowiedzi (input/textarea).
- Przycisk „Sprawdź odpowiedź".
- Przycisk „Previous" (na MVP).
- Normalizowane odpowiedzi (`Your (normalized) answer`, `Correct (normalized) answer`).
- Dodatkowe elementy techniczne niepotrzebne użytkownikowi.

### 3.4. Sprawdzanie odpowiedzi i feedback

Po naciśnięciu **ENTER** lub przycisku "Sprawdź odpowiedź":

- Odpowiedź użytkownika jest **przetwarzana i porównywana lokalnie** (na frontendzie) z właściwym tekstem.
- Porównanie jest **natychmiastowe** (bez opóźnień sieciowych) – wykorzystuje dane już dostępne w manifeście sesji.
- Po poprawnym wysłaniu odpowiedzi następuje **twarde przejście** ze stanu _Before check_ do stanu _After check_:
  - Pole odpowiedzi jest blokowane (`readonly`) albo całkowicie ukrywane.
  - Użytkownik **nie może poprawić odpowiedzi po fakcie** – próba jest jednoznacznie zamknięta.
- Feedback wizualny (w stanie _After check_):
  - **Wynik globalny**:
    - `Correct ✅` lub `Not correct ❌`.
  - **Porównanie tekstowe (diff)**:
    - Pokazanie:
      - **Twoja odpowiedź** (readonly, z zaznaczonymi różnicami na czerwono).
      - **Poprawna odpowiedź** (zaznaczone brakujące / inne fragmenty na zielono).
    - Automatyczny diff znakowy / słowny:
      - Podświetlenie fragmentów, które się różnią.
      - Bez wymogu ręcznego wskazywania przez użytkownika.
- Po feedbacku:
  - ENTER (lub przycisk "Następna karta") przechodzi do kolejnej karty lub kończy rundę (jeśli to ostatnia karta).
  - Fraza jest oznaczona jako:
    - **Correct** – jeśli spełnia kryteria dopasowania.
    - **Incorrect** – jeśli nie spełnia (trafia do listy "błędnych" na koniec rundy).
- **Statystyki sesji**:
  - Liczniki (poprawne / niepoprawne / pozostałe w rundzie) mogą być aktualizowane na bieżąco, ale:
    - Są prezentowane w formie **pasywnej**, niekonkurującej z zadaniem (nie w centralnej części widoku, nie obok inputu).

### 3.5. Zakończenie rundy i kolejne rundy

Po przejściu wszystkich kart w rundzie:

- Ekran podsumowania:
  - Wyświetla **nazwę notatnika** (nie ID).
  - `X / Y poprawnych`.
  - `Z błędnych (do powtórki)`.
- Jeśli **są błędne frazy**:
  - Propozycja: “Rozpocznij kolejną rundę z błędnymi frazami”.
  - Nowa runda:
    - Zawiera tylko frazy błędne z poprzedniej rundy.
    - Są one **tasowane** (shuffle włączony na stałe dla rund z błędnymi).
- Jeśli **brak błędnych fraz**:
  - Komunikat w stylu: “Wszystkie frazy poprawne! Możesz rozpocząć nową sesję od początku”.

---

## 4. Logika porównywania odpowiedzi

### 4.1. Ogólne założenia

- Użytkownik oczekuje **tolerancji**:
  - Ignorujemy **wielkość liter**.
  - Ignorujemy **interpunkcję** końcową (np. `?`, `.`, `!` na końcu).
  - Ignorujemy nadmiarowe spacje.
- Ten sam algorytm dopasowania dla:
  - EN→PL i PL→EN (z możliwością późniejszego zaostrzenia PL→EN).
- Algorytm porównywania działa **po stronie frontendu** (lokalnie) dla natychmiastowej odpowiedzi.
- Endpoint `POST /api/notebooks/:id/learn/check-answer` istnieje w backendzie, ale w MVP nie jest używany – porównanie odbywa się lokalnie.

### 4.2. Tryby sprawdzania odpowiedzi

- **Exact match** (domyślnie):
  - Wymaga pełnej, dokładnej odpowiedzi po normalizacji.
  - `normalizedUser === normalizedCorrect`.
- **Contains mode** (opcjonalny):
  - Akceptuje odpowiedź, jeśli znormalizowana odpowiedź użytkownika pasuje do **dowolnego słowa** w znormalizowanej poprawnej odpowiedzi.
  - Przykład: dla poprawnej odpowiedzi "siniak stłuczenie sińce" akceptuje "siniak", "stłuczenie" lub "sińce".
  - Użyteczne dla fraz z wieloma synonimami/odpowiedziami.

### 4.3. Normalizacja przed porównaniem

Dla obu tekstów (`userAnswer`, `correctAnswer`):

- **Kroki normalizacji** (koncepcyjnie, implementacja może używać istniejącego `normalizeText` jako bazy):
  - Trim początku i końca.
  - Redukcja wielokrotnych spacji do pojedynczej.
  - Konwersja do **lowercase**.
  - Usunięcie końcowej interpunkcji typu `.`, `?`, `!`, `…` (jeśli występuje ciągiem na końcu).
  - Ew. usunięcie innych znaków nieistotnych wg analogii do `normalizeText` (zero-width, itp.).

**Warunek poprawności**:

- Odpowiedź uznajemy za poprawną, jeśli:
  - `normalizedUser === normalizedCorrect`.
- Literówki / lekko inne słowa → na MVP traktowane jako błędne, ale:
  - Różnice są **wizualnie podkreślane** po stronie frontendu na podstawie wyniku porównania / struktury diffu,
    aby użytkownik widział, że "prawie trafił".

### 4.4. Wizualny diff

- Na potrzeby UI:
  - Generujemy strukturę różnic (np. na poziomie słów lub znaków), wykorzystując dane po normalizacji **lokalnie na frontendzie**.
  - Wyświetlanie:
    - W "Twojej odpowiedzi": różne fragmenty oznaczone kolorem (np. czerwone tło/podkreślenie).
    - W "Poprawnej odpowiedzi": brakujące / inne fragmenty oznaczone na zielono.
- Użytkownik nie musi sam wskazywać błędnych fragmentów – zaznaczenie jest automatyczne.
- **Informacje techniczne o normalizacji** (np. `Your (normalized) answer`, `Correct (normalized) answer`) **nie są nigdy prezentowane w UI** – służą wyłącznie logice porównywania i diffu.

---

## 5. Audio w trybie nauki

### 5.1. Zasady odtwarzania

- **Po wejściu na kartę** (tylko w stanie _Before check_):
  - EN→PL:
    - Automatycznie odtwarzany odpowiedni angielski segment audio (np. EN1 lub spójnie wybrany głos).
  - PL→EN:
    - Automatycznie odtwarzany polski segment audio.
- Audio odtwarza się **tylko raz** przy wejściu na kartę.
- Po przejściu do stanu _After check_ audio nie odtwarza się ponownie.
- Jeśli w manifeście/audio brak segmentu dla właściwego języka:
  - Sesja nauki działa normalnie tekstowo.
  - Brak automatycznego odtwarzania.

### 5.2. Sterowanie audio

- **Brak przycisku Play** – audio odtwarza się tylko automatycznie.
- Prędkość odtwarzania:
  - Docelowo może być współdzielona z globalnymi ustawieniami playera (0.75 / 0.9 / 1.0 / 1.25), ale to szczegół implementacyjny.

---

## 6. Zachowanie względem danych i DB

### 6.1. Brak zmian w schemacie DB na MVP

- W tej iteracji **nie wprowadzamy zmian w DB**:
  - Brak kolumny `is_hard` / `difficulty` w `phrases`.
  - Brak tabeli `learning_stats`.
- **Oznaczanie trudnych fraz**:
  - Uznane za wartościowe, ale odłożone na później, ponieważ:
    - Wymagałoby:
      - Nowej kolumny (`phrases.is_hard boolean default false`) **lub**
      - Osobnej tabeli `phrase_flags` (`phrase_id`, `user_id`, `flag_type`).
- **Statystyki sesji**:
  - Przechowywane wyłącznie w pamięci (stan frontendowej sesji).

### 6.2. Wymagania dla backendu (wysoki poziom)

- Endpointy do trybu nauki **korzystają z istniejących**:
  - Pobieranie fraz notatnika (`GET /api/notebooks/:id/learn-manifest`).
  - Pobieranie manifestu audio (`GET /api/notebooks/:id/playback-manifest`).
  - Pobieranie nazwy notatnika (`GET /api/notebooks/:id`).
- W MVP cała logika jest **czysto frontendowa**:
  - Losowanie/shuffle.
  - Budowa listy rund.
  - Liczenie statystyk.
  - **Walidacja odpowiedzi (porównanie tekstowe)** – wykonywane lokalnie na frontendzie dla natychmiastowej odpowiedzi.
- Endpoint `POST /api/notebooks/:id/learn/check-answer` istnieje w backendzie, ale w MVP nie jest używany (porównanie lokalne).
- W przyszłości:
  - Możliwość przeniesienia części logiki (np. zapis progresu) do backendu.

---

## 7. Interakcje klawiaturowe (skróty)

- **ENTER**:
  - Jeśli odpowiedź nie jest jeszcze sprawdzona (`!isChecked`) → **Sprawdź odpowiedź** (`checkAnswer`).
  - Jeśli odpowiedź jest już sprawdzona (`isChecked`) → **Następna karta** (`nextCard`) lub zakończenie rundy, jeśli to ostatnia karta.
- Brak innych wyjątków / warunków dla ENTER – zachowanie jest **jednoznaczne** w obu stanach.
- **Uwaga**: Skróty klawiaturowe są opisane w podpowiedziach UI, ale nie są częścią nazw przycisków.

---

## 8. Edge cases i zachowania szczególne

- **Pusta odpowiedź**:
  - Traktowana jako błędna (chyba że użytkownik wybierze “Skip” zamiast “Sprawdź”).
- **Bardzo długie odpowiedzi**:
  - Nadal porównywane tekstowo; UI może limitować wysokość pola z możliwością scrollowania.
- **Brak fraz w notatniku**:
  - Wejście w tryb nauki powinno być zablokowane / pokazywać informację “Brak fraz w notatniku”.
- **Brak audio**:
  - Nauka tekstowa działa w pełni.
  - W razie braku audio dla języka docelowego – brak automatycznego odtwarzania.
- **Odświeżenie strony / zamknięcie karty**:
  - Sesja jest tracona (statystyki i rundy od zera po wejściu ponownie).

---

## 9. Podsumowanie

- Tryb nauki to **osobna ścieżka** `/notebooks/[id]/learn` z **full-focus UI** dla pojedynczej karty.
- Obsługuje **EN→PL i PL→EN**, z **tolerancyjnym porównaniem** (ignorujemy case, końcową interpunkcję, nadmiarowe spacje).
- **Dwa tryby sprawdzania odpowiedzi**:
  - **Exact match**: wymaga pełnej, dokładnej odpowiedzi.
  - **Contains mode**: akceptuje odpowiedź, jeśli pasuje do dowolnego słowa w poprawnej odpowiedzi.
- Sesje składają się z **rund**:
  - Runda 1: wszystkie frazy (z opcją shuffle).
  - Kolejne rundy: tylko błędne z poprzedniej.
- **Porównywanie odpowiedzi jest lokalne** (frontend) dla natychmiastowej odpowiedzi bez opóźnień sieciowych.
- Audio jest **opcjonalnym, ale preferowanym** dodatkiem:
  - Automatyczne odtwarzanie właściwego języka przy wejściu na kartę (tylko raz).
  - Brak przycisku Play – audio odtwarza się tylko automatycznie.
- MVP **nie wymaga zmian w DB** – cała logika nauki i statystyki są na frontendzie, przyszłe rozszerzenia mogą dodać "hard flags" i trwały progres.
