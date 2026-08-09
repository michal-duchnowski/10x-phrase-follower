# Fiszki: krótki przewodnik

Ten przewodnik opisuje działanie zakładki **Flashcards** w Phrase Follower. Fiszki używają algorytmu FSRS: harmonogram jest liczony osobno dla każdej strony fiszki i dopasowuje się do historii Twoich ocen.

## Najważniejsza zasada

Po sprawdzeniu odpowiedzi wybierasz ocenę własnego przypomnienia. To **wybrany przycisk** wyznacza następny termin powtórki. Sam wynik automatycznego sprawdzenia tekstu (`Correct`, `Partial match`, `Not correct`) nie zmienia harmonogramu.

Możesz też zostawić pole odpowiedzi puste i nacisnąć `Enter` lub `Check answer`. Wtedy od razu zobaczysz odpowiedź i wybierzesz ocenę ręcznie. Taki przegląd zapisuje się jako `manual` i również nie wpływa na termin poza wybraną oceną.

## Co oznaczają przyciski

| Przycisk | Wybierz, gdy...                                              | Znaczenie dla FSRS                                      |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| `Again`  | Nie pamiętałeś/-aś odpowiedzi.                               | Fiszka wraca do nauki lub ponownej nauki.               |
| `Hard`   | Odpowiedź przyszła z dużym wysiłkiem albo po długim wahaniu. | Termin jest krótszy niż przy `Good`.                    |
| `Good`   | Odpowiedź była poprawna i normalnie dostępna z pamięci.      | Standardowy postęp dla fiszki.                          |
| `Easy`   | Odpowiedź była natychmiastowa i zdecydowanie zbyt łatwa.     | Fiszka dostaje wyraźnie dłuższy termin niż przy `Good`. |

Nie wybieraj `Hard`, gdy odpowiedzi w ogóle nie pamiętasz. W tej sytuacji właściwe jest `Again`. `Hard` oznacza, że odpowiedź jednak została przywołana.

Skróty klawiszowe po pokazaniu odpowiedzi: `1` = Again, `2` = Hard, `3` = Good, `4` = Easy.

## Dlaczego fiszka wraca za kilka minut

Nowe fiszki przechodzą najpierw przez krótkie kroki nauki. Aktualna konfiguracja to:

| Stan nowej fiszki | Termin                                                                         |
| ----------------- | ------------------------------------------------------------------------------ |
| `Again`           | 1 minuta                                                                       |
| `Hard`            | około 6 minut                                                                  |
| `Good`            | 10 minut                                                                       |
| `Easy`            | kończy naukę i przechodzi do powtórek długoterminowych, zwykle po kilku dniach |

Zatem `Good` po raz pierwszy nie oznacza jeszcze „dobrze zapamiętane na wiele dni”. Oznacza przejście do kolejnego kroku nauki. Druga poprawna ocena pozwala FSRS zacząć planować dłuższe odstępy.

Jeżeli fiszka była już w regularnych powtórkach, `Again` daje krok ponownej nauki za 10 minut. Pozostałe oceny są liczone indywidualnie przez FSRS. Nie mają stałych czasów, bo algorytm bierze pod uwagę między innymi stabilność pamięci, trudność fiszki, liczbę powtórek, poprzednie pomyłki i to, czy powtórka nastąpiła terminowo.

`Easy` po kilku udanych powtórkach może oznaczać tygodnie, a później miesiące. `Good` w tym samym momencie nadal będzie miał krótszy termin niż `Easy`, ale nie cofnie fiszki do 10 minut.

## Cel retencji

Domyślny cel retencji wynosi 90%. Oznacza to, że algorytm planuje termin wtedy, gdy przewidywane prawdopodobieństwo przypomnienia zbliża się do 90%. Wyższa retencja oznacza częstsze powtórki; niższa oznacza mniej powtórek i więcej zapomnień. Obecnie wartość retencji jest przechowywana w ustawieniach systemu, ale nie jest jeszcze edytowana w interfejsie.

## Dwie strony jednej frazy

Każda fraza ma dwie niezależne fiszki:

- `English to Polish`: widzisz angielską frazę i wpisujesz polskie znaczenie.
- `Polish to English`: widzisz polskie znaczenie i wpisujesz angielską frazę.

Oceny i terminy tych stron są niezależne. Możesz dobrze znać znaczenie angielskiej frazy, ale nadal potrzebować ćwiczyć jej aktywne odtwarzanie po polskim haśle.

## Due now i Overdue

- **Due now**: wszystkie fiszki, których termin już nadszedł, także te sprzed kilku minut.
- **Overdue**: fiszki zaległe od wcześniejszego dnia. To część puli Due now.

Przykład: fiszka z terminem dziś o 10:00 jest o 11:00 w `Due now`, ale nie w `Overdue`. Fiszka z terminem wczoraj jest w obu grupach.

## Kolejność sesji

Najpierw trafiają do sesji bieżące i zaległe powtórki, od najwcześniejszego terminu. Nowe frazy są dodawane tylko wtedy, gdy pula powtórek nie wypełniła limitu sesji i liczba zaległości nie jest zbyt duża.

Ustawienia mają różne jednostki:

- **Reviews per batch** liczy pojedyncze kierunki fiszek. Limit 50 może oznaczać 25 fraz, gdy obie strony są do powtórki.
- **New phrases per batch** liczy całe frazy. Każda nowa fraza dodaje oba kierunki.

Domyślne limity to 50 powtórek i 5 nowych fraz na sesję.

## Jak korzystać szybko i uczciwie

1. Gdy chcesz aktywnie ćwiczyć, wpisz odpowiedź i naciśnij `Enter`.
2. Gdy znasz słowo bez wahania, zostaw pole puste, naciśnij `Enter` i wybierz właściwą ocenę.
3. Używaj `Again` przy faktycznym braku odpowiedzi, nie `Hard`.
4. Używaj `Easy` oszczędnie. Jest przeznaczone dla odpowiedzi natychmiastowych, nie tylko poprawnych.
5. Najpierw usuń zaległości, a dopiero potem zwiększaj liczbę nowych fraz.

## Dodatkowe informacje o frazie

Po pokazaniu odpowiedzi przycisk opisu znajduje się obok głośnika. Otwiera wspólny opis frazy z obsługą Markdown i trybem podglądu. Ten sam przycisk jest używany w Flashcards, Learn i Notatniku.

Na stronie głównej Flashcards dostępna jest też lista najtrudniejszych fiszek. Bierze pod uwagę między innymi ostatnie oceny `Again` i `Hard`, liczbę pomyłek, trudność, stabilność oraz zaległość.
