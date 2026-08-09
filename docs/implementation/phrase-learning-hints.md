# Phrase Learning Hints

## Cel

Przyszłe rozszerzenie ma umożliwić zapisanie przy frazie dodatkowej notatki edukacyjnej, która pomaga utrwalić słowo lub wyrażenie.

Notatka nie musi być prostym przykładem EN/PL. Może zawierać kilka przykładów, kontekst użycia, kolokacje, mini-regułę gramatyczną, false friends, mnemonikę albo inne wskazówki przygotowane ręcznie lub wygenerowane przed importem przez GPT.

## Rekomendowany model danych

- Dodać do tabeli `phrases` opcjonalną kolumnę `learning_hint_markdown text null`.
- Pole traktować jako materiał edukacyjny w Markdown, nie jako część właściwej odpowiedzi.
- Proponowany limit długości: ok. 8000-12000 znaków, większy niż limit `en_text`/`pl_text`, bo hint może zawierać obszerniejsze objaśnienie.
- RLS bez osobnych zasad: dostęp dziedziczony przez istniejący dostęp do `phrases` przez właściciela notatnika.

## Import

Zachować kompatybilność ze starym formatem:

```text
EN text ::: PL text
```

Dodać wariant z hintem:

```text
EN text ::: PL text ::: learning hint markdown
```

Aktualny wariant dla hintu uzywa jawnych markerow otwarcia i zamkniecia:

```text
EN text ::: PL text :::"learning hint markdown":::
```

Marker otwarcia to `:::"`, marker zamkniecia to `":::`. Dzieki temu tresc hintu moze zawierac zwykle `:::` w Markdown.

Zasady parsera:

- Akceptować dokładnie 2 albo 3 części po separatorze `:::`.
- Linie z 1 częścią, pustym EN/PL albo większą liczbą separatorów odrzucać z jasnym powodem.
- Treść hintu nie może zawierać sekwencji `:::`. Jeśli w przyszłości będzie potrzebny pełny Markdown bez ograniczeń separatora, należy rozważyć import CSV/TSV/JSONL.

## UI

- W widoku notatnika warto dodać akcję edycji hintu dla pojedynczej frazy, najlepiej jako prosty modal z polem Markdown.
- W trybie nauki warto dodać akcję `Add/Edit description` bezpośrednio na karcie, ponieważ właśnie tam użytkownik najczęściej zauważy brak kontekstu po błędnej odpowiedzi.
- Na desktop/web akcja może być widoczna jako mały drugorzędny przycisk po sprawdzeniu odpowiedzi, np. obok sekcji hintu albo w prawym górnym rogu obszaru feedbacku.
- Akcja edycji nie powinna być widoczna przed sprawdzeniem odpowiedzi, żeby nie podpowiadała i nie odciągała uwagi od recall.
- Na mobile akcja nie powinna dodawać stałego przycisku do głównego dolnego paska, bo ten pasek jest krytyczny dla flow `Check answer` / `Try again` / `Next card`.
- Na mobile preferowane warianty:
  - ukrycie akcji w istniejącym menu kontekstowym / overflow,
  - mała ikonka przy nagłówku sekcji hintu widoczna dopiero po sprawdzeniu,
  - link tekstowy `Edit` wewnątrz rozwiniętego hintu, bez udziału w głównych akcjach nawigacyjnych.
- Formularz edycji powinien otwierać modal lub bottom sheet z polem Markdown i akcjami `Save` / `Cancel`; zapis powinien aktualizować bieżącą kartę bez restartu sesji learn.
- W trybie nauki hint powinien być widoczny po sprawdzeniu odpowiedzi:
  - przy błędnej odpowiedzi: rozwinięty automatycznie,
  - przy poprawnej odpowiedzi: opcjonalnie zwinięty lub mniej wyeksponowany.
- Hint powinien pojawiać się po sekcji poprawnej odpowiedzi/diffu, żeby nie podpowiadał przed udzieleniem odpowiedzi.
- Markdown powinien być renderowany w sposób bezpieczny i spójny z obecnym renderowaniem tekstów fraz.

## Przykład importu

```text
afford ::: móc sobie pozwolić ::: **Usage:** often used with `can/can't afford`.

Examples:
- I can't afford a new car.
- Can we afford to wait?

Hint: after **afford** often comes a noun or `to + verb`.
```
