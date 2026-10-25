# Analiza problemów layoutu eksportu fiszek

Data: 2026-10-25

## Wniosek

Problemy z kontrastem wynikają z niespójnego zakresu ciemnego motywu i dziedziczenia koloru tekstu. Kolejne poprawki obejmowały pojedyncze elementy zamiast wspólnego layoutu. Różnice w kolorach przycisków wynikają dodatkowo z ręcznych nadpisań stylów.

## 1. Ciemne nagłówki na ciemnym tle

W `src/layouts/AppLayout.astro:23` element `body` ma klasy `bg-background text-foreground`, natomiast klasa `dark` znajduje się dopiero na wewnętrznym kontenerze:

```astro
<body class="bg-background text-foreground overflow-x-hidden">
  <div class="min-h-screen bg-background dark w-full"></div></body
>
```

`body` oblicza kolor tekstu przy użyciu zmiennych jasnego motywu. Wewnętrzny kontener zmienia zmienne CSS na wartości ciemnego motywu, lecz nie ustawia ponownie właściwości `color`. Dziedziczy więc już obliczony, ciemny kolor tekstu z `body`.

W `src/styles/global.css` kolor `--foreground` wynosi:

- W jasnym motywie: `oklch(0.3211 0 0)`.
- W ciemnym motywie: `oklch(0.9219 0 0)`.

Nagłówki i etykiety w `src/components/FlashcardsExportView.tsx` nie ustawiają własnego koloru tekstu. Dotyczy to nagłówka strony, obu nagłówków sekcji oraz etykiet formularza. Dziedziczą ciemny kolor, mimo że ich tło korzysta już z ciemnego motywu.

Podobny układ z klasą `dark` na wewnętrznym kontenerze występuje w `src/layouts/Layout.astro`.

## 2. Dlaczego poprzednia poprawka nie rozwiązała problemu

Commit `819efc0` (`fix: simplify export UI and generate unique filenames`) dodał `text-foreground` do pola liczbowego, obu list wyboru oraz pola tekstowego do ręcznego kopiowania Markdown.

Te elementy obliczają dzięki temu kolor w zakresie ciemnego motywu. Nagłówki i etykiety nadal dziedziczą kolor z `body`, ponieważ nie zostały objęte poprawką.

To tłumaczy kolejne zgłoszenia dotyczące różnych elementów tego samego widoku: lokalne poprawki pozostawiały źródłowy problem w layoucie.

## 3. Różne kolory przycisków

W `src/components/FlashcardsView.tsx:639` przyciski mają ręczne nadpisania:

- Trudne fiszki: `bg-amber-400 text-black`.
- Eksport: `bg-violet-500 text-white`.
- Ustawienia: `bg-sky-400 text-black`.

Nadpisania omijają wspólną paletę komponentu `Button`. Notatki w `.agents/project-notes.md` zalecają domyślny, zielony wariant dla głównych akcji.

Osobno commit `819efc0` zmienił przycisk kopiowania na stronie eksportu z wariantu `secondary` na `default`. Ujednoliciło to przyciski pobierania i kopiowania, ale nie usunęło ręcznych kolorów przycisków na głównej stronie fiszek.

## 4. Dlaczego obecne sprawdzenia nie wykrywają regresji

`vitest.config.ts` ustawia środowisko testowe `node`. Testy eksportu sprawdzają dane i API, a nie końcowy wygląd strony w przeglądarce.

Takie testy nie wykryją nieczytelnego nagłówka, niewłaściwego kontrastu pola ani rozbieżności kolorów przycisków. Potrzebna jest weryfikacja renderowanego widoku po zmianach interfejsu.

## 5. Dodatkowe źródło niejasności: konfiguracja Tailwind

Projekt używa Tailwind CSS 4 i konfiguracji motywu w `src/styles/global.css` przez `@theme inline`. Repozytorium zawiera również `tailwind.config.mjs`, ale w sprawdzonym kodzie nie znaleziono dyrektywy `@config` wczytującej ten plik.

Tailwind 4 nie wykrywa automatycznie konfiguracji JavaScript. Stary plik może więc wprowadzać w błąd podczas ustalania aktywnej palety. Nie jest to bezpośrednia przyczyna znikających nagłówków.

Ponadto stara konfiguracja opakowuje część zmiennych w `oklch(var(...))`, podczas gdy aktualne zmienne zawierają już pełne wartości `oklch(...)`. Nie należy aktywować tej konfiguracji bez jej uprzedniego uporządkowania.

## Zalecana naprawa

1. Przenieść klasę `dark` na element `html` w layoutach, aby `body`, tło i tekst korzystały z tego samego zestawu zmiennych.
2. Ujednolicić przyciski zgodnie ze wspólnymi wariantami i zasadami projektu.
3. Uporządkować nieaktywną konfigurację Tailwind, aby istniało jedno czytelne źródło palety.
4. Sprawdzić w przeglądarce nagłówki, etykiety, pola, listy wyboru i przyciski, również w stanach disabled, hover i focus.

## Zakres i ograniczenia badania

Analiza obejmuje kod źródłowy, konfigurację, notatki projektu oraz historię commitów. Podczas badania lokalna aplikacja pod `http://localhost:3000` nie odpowiadała, dlatego nie wykonano wizualnego potwierdzenia ani pomiaru kontrastu w przeglądarce.

Pierwotna analiza nie obejmowała zmian kodu. Poniższa aktualizacja opisuje późniejszą realizację zaleceń.

## Aktualizacja: realizacja zaleceń

- W obu layoutach klasa `dark` znajduje się na `html`. Dzięki temu kolor tekstu na `body` od początku korzysta z ciemnego motywu, również dla nagłówków i etykiet dziedziczących kolor. Usunięto dotychczasowe klasy `dark` z wewnętrznych kontenerów.
- Zgodnie z późniejszym doprecyzowaniem użytkownika zachowano różne tła trzech przycisków ikonowych na górze fiszek: żółte dla trudnych fiszek, fioletowe dla eksportu i niebieskie dla ustawień. Wcześniejsze ujednolicenie ich do zielonego koloru cofnięto. Uzupełniono brakujące etykiety `aria-label` przycisków ikonowych. Różne kolory tych trzech przycisków są zamierzone i nie stanowią błędu layoutu.
- Usunięto nieaktywny `tailwind.config.mjs`. Źródłem palety pozostaje `src/styles/global.css`.
- Prettier potwierdził formatowanie zmienionych komponentów i layoutów. ESLint zakończył się bez błędów; zgłosił trzy istniejące ostrzeżenia dotyczące zależności hooków w `FlashcardsView.tsx`.
- Obraz `phrase-follower:local` przebudowano i uruchomiono w Dockerze. Kontener ma stan `healthy`, a `/api/health` zwraca HTTP 200 oraz `db: ok`. Strony `/flashcards/export` i `/login` zwracają HTTP 200, a ich HTML zawiera klasę `dark` na elemencie `html`.

Automatyczna kontrola przeglądarki pozostaje niedostępna: narzędzie nie wykrywa podłączonego Chrome ani przeglądarki wbudowanej. Chrome jest zainstalowany i działa; wysłano mu systemowe polecenie otwarcia strony eksportu. Nie jest to równoznaczne z wizualnym potwierdzeniem poprawki. Nadal potrzebna jest kontrola wyglądu i stanów interakcji w przeglądarce.

## Dokumentacja zewnętrzna

- [Tailwind CSS — Dark mode](https://tailwindcss.com/docs/dark-mode): zakres klasy sterującej ciemnym motywem.
- [Tailwind CSS — Upgrade guide](https://tailwindcss.com/docs/upgrade-guide): konfiguracje JavaScript w wersji 4 nie są wykrywane automatycznie.
- [Tailwind CSS — Functions and directives](https://tailwindcss.com/docs/functions-and-directives): jawne wczytywanie starszej konfiguracji przez `@config`.
