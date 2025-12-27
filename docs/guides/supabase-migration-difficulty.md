# Migracja: Dodanie kolumny difficulty do tabeli phrases

Ten przewodnik opisuje jak zastosować migrację dodającą kolumnę `difficulty` do tabeli `phrases`.

## Przegląd migracji

Migracja `20251227093548_add_phrase_difficulty.sql` dodaje:

- Kolumnę `difficulty` (nullable text) do tabeli `phrases`
- Constraint sprawdzający wartości: `difficulty IN ('easy', 'medium', 'hard')`
- Indeks złożony: `(notebook_id, difficulty, position)` dla wydajnego filtrowania

## Opcja 1: Lokalne środowisko (Supabase Local)

Jeśli używasz lokalnej instancji Supabase do developmentu:

### Krok 1: Uruchom lokalny Supabase

```bash
# Uruchom lokalny Supabase (jeśli nie jest uruchomiony)
supabase start
```

### Krok 2: Zastosuj migrację

```bash
# Zastosuj wszystkie nowe migracje
supabase db reset
```

**LUB** jeśli chcesz zastosować tylko nową migrację bez resetowania danych:

```bash
# Zastosuj migrację bez resetowania
supabase migration up
```

### Krok 3: Weryfikacja

Sprawdź czy migracja została zastosowana:

```bash
# Połącz się z lokalną bazą
supabase db connect

# W konsoli PostgreSQL wykonaj:
\d phrases

# Powinieneś zobaczyć kolumnę difficulty w liście kolumn
```

**LUB** sprawdź w Supabase Studio:

1. Otwórz `http://localhost:54323` (Supabase Studio)
2. Przejdź do **Table Editor** → **phrases**
3. Sprawdź czy kolumna `difficulty` jest widoczna

## Opcja 2: Supabase Cloud (Produkcja)

Jeśli używasz Supabase Cloud:

### Krok 1: Połącz projekt z cloudowym Supabase

```bash
# Jeśli jeszcze nie połączyłeś projektu
supabase link --project-ref <project-ref>

# project-ref znajdziesz w:
# - URL projektu: https://app.supabase.com/project/<project-ref>
# - Settings → General → Reference ID
```

### Krok 2: Zastosuj migrację

```bash
# Wypchnij wszystkie migracje do cloudowej bazy
supabase db push
```

**UWAGA:** To zastosuje wszystkie migracje, które nie zostały jeszcze wykonane w cloudowej bazie.

### Krok 3: Weryfikacja w Dashboard

1. Przejdź do [Supabase Dashboard](https://app.supabase.com)
2. Wybierz swój projekt
3. Przejdź do **Database** → **Tables** → **phrases**
4. Sprawdź czy kolumna `difficulty` jest widoczna w schemacie

**LUB** użyj SQL Editor:

1. Przejdź do **SQL Editor**
2. Wykonaj zapytanie:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'phrases' AND column_name = 'difficulty';
```

Powinieneś zobaczyć:

- `column_name`: `difficulty`
- `data_type`: `text`
- `is_nullable`: `YES`

## Opcja 3: Ręczne wykonanie (SQL Editor)

Jeśli nie możesz użyć CLI lub chcesz wykonać migrację ręcznie:

### Krok 1: Otwórz SQL Editor

1. W Supabase Dashboard przejdź do **SQL Editor**
2. Kliknij **"New query"**

### Krok 2: Skopiuj i wykonaj migrację

Otwórz plik `supabase/migrations/20251227093548_add_phrase_difficulty.sql` i skopiuj jego zawartość:

```sql
-- Add difficulty column to phrases table
-- Difficulty is a nullable text field with check constraint: 'easy', 'medium', 'hard', or NULL (unset)

ALTER TABLE phrases ADD COLUMN difficulty text NULL;

-- Add check constraint to ensure only valid values
ALTER TABLE phrases ADD CONSTRAINT phrases_difficulty_check
  CHECK (difficulty IS NULL OR difficulty IN ('easy', 'medium', 'hard'));

-- Add composite index for efficient filtering by notebook_id, difficulty, and position
CREATE INDEX phrases_idx_notebook_difficulty_position
  ON phrases(notebook_id, difficulty, position);

-- Add comment
COMMENT ON COLUMN phrases.difficulty IS 'Difficulty level: easy, medium, hard, or NULL (unset)';
```

### Krok 3: Wykonaj zapytanie

1. Wklej SQL do edytora
2. Kliknij **"Run"** lub naciśnij `Ctrl+Enter` (Windows) / `Cmd+Enter` (Mac)
3. Sprawdź czy nie ma błędów

### Krok 4: Weryfikacja

Wykonaj zapytanie weryfikujące:

```sql
-- Sprawdź czy kolumna istnieje
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'phrases' AND column_name = 'difficulty';

-- Sprawdź czy constraint istnieje
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'phrases' AND constraint_name = 'phrases_difficulty_check';

-- Sprawdź czy indeks istnieje
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'phrases' AND indexname = 'phrases_idx_notebook_difficulty_position';
```

## Regeneracja typów TypeScript

Po zastosowaniu migracji, zregeneruj typy TypeScript z bazy danych:

### Opcja A: Supabase CLI (zalecane)

```bash
# Wygeneruj typy z lokalnej bazy
supabase gen types typescript --local > src/db/database.types.ts

# LUB z cloudowej bazy
supabase gen types typescript --linked > src/db/database.types.ts
```

### Opcja B: Supabase Dashboard

1. Przejdź do **Settings** → **API**
2. W sekcji **"Generate TypeScript types"** kliknij **"Generate types"**
3. Skopiuj wygenerowany kod
4. Zastąp zawartość pliku `src/db/database.types.ts`

**UWAGA:** Po regeneracji typów, sprawdź czy `phrases` ma teraz pole `difficulty`:

```typescript
phrases: {
  Row: {
    // ... inne pola
    difficulty: string | null; // <-- powinno być tutaj
  }
  // ...
}
```

## Rozwiązywanie problemów

### Problem: "column already exists"

Jeśli widzisz błąd `column "difficulty" already exists`, oznacza to, że migracja została już zastosowana. Możesz to sprawdzić:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'phrases' AND column_name = 'difficulty';
```

Jeśli zwraca wynik, migracja już została zastosowana - możesz ją pominąć.

### Problem: "constraint already exists"

Jeśli constraint już istnieje, możesz go usunąć przed ponownym dodaniem:

```sql
-- Sprawdź czy constraint istnieje
SELECT constraint_name
FROM information_schema.table_constraints
WHERE table_name = 'phrases' AND constraint_name = 'phrases_difficulty_check';

-- Jeśli istnieje, usuń go
ALTER TABLE phrases DROP CONSTRAINT IF EXISTS phrases_difficulty_check;

-- Następnie wykonaj migrację ponownie
```

### Problem: "index already exists"

Jeśli indeks już istnieje:

```sql
-- Sprawdź czy indeks istnieje
SELECT indexname
FROM pg_indexes
WHERE tablename = 'phrases' AND indexname = 'phrases_idx_notebook_difficulty_position';

-- Jeśli istnieje, usuń go
DROP INDEX IF EXISTS phrases_idx_notebook_difficulty_position;

-- Następnie wykonaj migrację ponownie
```

### Problem: "permission denied"

Upewnij się, że:

- Jesteś zalogowany do Supabase Dashboard
- Masz uprawnienia do modyfikacji schematu bazy danych
- Używasz odpowiedniego klucza API (service_role dla operacji administracyjnych)

### Problem: Typy TypeScript nie są zaktualizowane

1. Upewnij się, że regenerowałeś typy po migracji
2. Sprawdź czy plik `src/db/database.types.ts` zawiera pole `difficulty`
3. Jeśli nie, wykonaj regenerację typów (patrz sekcja powyżej)
4. Zrestartuj TypeScript server w IDE (w VS Code: `Ctrl+Shift+P` → "TypeScript: Restart TS Server")

## Weryfikacja końcowa

Po pomyślnej migracji:

1. ✅ Kolumna `difficulty` istnieje w tabeli `phrases`
2. ✅ Constraint `phrases_difficulty_check` jest aktywny
3. ✅ Indeks `phrases_idx_notebook_difficulty_position` został utworzony
4. ✅ Typy TypeScript zostały zregenerowane
5. ✅ Aplikacja działa bez błędów TypeScript

Możesz przetestować funkcjonalność:

```sql
-- Przetestuj dodanie difficulty do frazy
UPDATE phrases
SET difficulty = 'hard'
WHERE id = '<some-phrase-id>'
RETURNING id, en_text, difficulty;

-- Przetestuj filtrowanie
SELECT id, en_text, difficulty
FROM phrases
WHERE difficulty = 'hard'
LIMIT 5;
```

## Następne kroki

Po pomyślnej migracji:

1. ✅ Zaktualizuj dokumentację projektu
2. ✅ Przetestuj funkcjonalność difficulty w aplikacji:
   - Filtrowanie w NotebookView
   - Oznaczanie difficulty w PlayerShell (klawisze 1/2/3/0)
   - Oznaczanie difficulty w LearnView (klawisze 1/2/3/0)
   - Masowe oznaczanie w NotebookView
3. ✅ Sprawdź czy wszystkie istniejące frazy mają `difficulty = NULL` (co jest poprawne - oznacza "unset")
