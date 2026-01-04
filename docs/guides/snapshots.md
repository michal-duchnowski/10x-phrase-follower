# Snapshot notatnika (kopiowanie zaznaczonych fraz) — spec dla implementacji

## Cel (co chcemy osiągnąć)

Użytkownik ma móc stworzyć **nowy zwykły notatnik** (snapshot) poprzez **skopiowanie zaznaczonych fraz** z:

- zwykłego notatnika
- Smart List (All Hard / All Medium / All Easy)

Snapshot ma być **niezależny od źródła** (kopiujemy teksty do nowego `notebook_id`), dzięki czemu po miesiącu wracam do tego zestawu jako do normalnego notatnika.

## Kluczowe decyzje (ustalone)

- **Kopiowanie danych, nie referencje**.
- Snapshot tworzymy **tylko z zaznaczonych fraz** (bulk selection).
- Tworzymy **zawsze nowy notatnik** (nie wspieramy „add to existing”).
- **Nazwa domyślna**: `[Snap_YYMMDD] <Źródło>`
  - przykład: `[Snap_250114] All Hard`
  - przykład: `[Snap_250114] Moje Phrasy B2`
- Po utworzeniu snapshotu **automatycznie przechodzimy do nowego notatnika** (bez toast/link jako alternatywy).
- **Brak modala** do ustawiania nazwy przed utworzeniem (rename później jak zawsze).
- **Nie kopiujemy**:
  - `difficulty` → ustawiamy `null`
- **Kopiujemy**:
  - `tokens` → kopiujemy z źródła (jeśli istnieją)
- **Nie generujemy audio** automatycznie; użytkownik może później kliknąć standardowe „Generate audio”.

## Czego nie wspieramy (non-goals / out of scope)

- Snapshot całego notatnika „1 klik” bez selekcji.
- Snapshot wszystkich elementów z Smart List (np. 1000) bez selekcji.
- Dopisywanie metadanych do nazwy (pinned/selected notebooks/filtry) — **nie komplikujemy**.
- Dodawanie do istniejącego notatnika („merge”).
- Dedup fraz w snapshot (jeśli użytkownik zaznaczy duplikaty/pozycje) — snapshot kopiuje dokładnie to, co user zaznaczył; ewentualnie deduplikacja `phrase_ids` po stronie backendu.
- Kopiowanie/utrzymanie `difficulty`.

## Kontekst techniczny (jak działa obecny kod)

- `phrases` są przypisane do notatnika przez `phrases.notebook_id` (1 fraza nie jest współdzielona między notatnikami).
- Smart listy to „wirtualne notatniki” o ID: `difficulty-easy|medium|hard`.
- Selekcja fraz już istnieje w `src/components/NotebookView.tsx` (`selectedPhraseIds: Set<string>`).
- Player/Learn pracują po `notebookId` i biorą dane z endpointów:
  - `/api/notebooks/:id/phrases`
  - `/api/notebooks/:id/playback-manifest`
  - `/api/notebooks/:id/learn-manifest`
    Snapshot jako zwykły notebook **nie wymaga zmian** w Player/Learn.

## UX / UI

### Miejsce akcji

- `NotebookView` (toolbar/sekcja działań bulk) — tam, gdzie użytkownik ma selekcję.

### Widoczność i stany

- Przycisk: **“Snapshot selected”**
- Disabled, gdy `selectedPhraseIds.size === 0`
- Loading podczas requestu; error jako toast/inline (jak inne akcje).

### Flow

1. Użytkownik zaznacza frazy.
2. Klik “Snapshot selected”.
3. Backend tworzy nowy notebook + kopiuje frazy.
4. Frontend przechodzi do `/notebooks/<newNotebookId>` (widok notatnika).

## Kontrakt API (propozycja minimalna)

### Endpoint

`POST /api/notebooks/snapshots`

### Body

```json
{
  "source_notebook_id": "<string>",
  "phrase_ids": ["<uuid>", "..."]
}
```

Uwagi:

- `source_notebook_id` jest wymagane tylko po to, aby zbudować nazwę źródła. Dla zwykłego notatnika to UUID, dla smart list to `difficulty-...`.
- W praktyce backend może też przyjąć `source_name` (z frontu), ale preferowane jest liczenie po stronie backendu, żeby nie ufać UI.

### Response 201

```json
{
  "id": "<new_notebook_uuid>",
  "name": "[Snap_250114] All Hard",
  "created_at": "<iso>",
  "updated_at": "<iso>"
}
```

### Błędy

- 400 `validation_error`: puste `phrase_ids`, niepoprawne UUID, za dużo elementów, itp.
- 401 `unauthorized`
- 404 `not_found`: źródłowy notebook nie istnieje (tylko dla zwykłych), lub frazy niedostępne
- 409 `conflict`: nazwa notebooka już istnieje (patrz sekcja „nazwa i konflikty”)
- 500 `internal`

## Walidacje i bezpieczeństwo

### Walidacje wejścia

- `phrase_ids`:
  - wymagane
  - po deduplikacji `>= 1`
  - `<= 100` (zgodnie z limitem notatnika z README)
  - wszystkie muszą być UUID
- `source_notebook_id`:
  - UUID lub `difficulty-(easy|medium|hard)`

### Autoryzacja i RLS

Backend musi zweryfikować, że wszystkie `phrase_ids` należą do usera:

- najprościej: `phrases` join/lookup przez `notebooks.user_id` (lub dwa kroki: pobierz `phrases` + `notebook_id` i zweryfikuj, że te notebooki należą do usera).
- wymaganie: jeśli backend znajdzie mniej rekordów niż liczba wejściowych `phrase_ids`, zwraca błąd (nie kopiujemy „częściowo” bez jasnego komunikatu).

## Zasady kopiowania (logika backend)

### Pobranie danych źródłowych

Dla `phrase_ids` pobierz:

- `en_text`
- `pl_text`
- `tokens` (kopiujemy jeśli istnieją)
- (opcjonalnie `created_at` do sortu, ale w tym specu kolejność pochodzi z UI → patrz niżej)

**Kolejność**:

- Snapshot ma zachować kolejność „z widoku”.
- Najprościej: frontend wysyła `phrase_ids` w kolejności jak na liście, a backend traktuje to jako kolejność docelową.

### Tworzenie notebooka

- `name` = `[Snap_YYMMDD] <Źródło>`
  - `YYMMDD` w strefie czasu użytkownika: na MVP wystarczy czas serwera (ISO date w UTC i format `YYMMDD`).
  - `<Źródło>`:
    - dla smart list: `All Easy/All Medium/All Hard`
    - dla zwykłego: `notebooks.name`
- insert do `notebooks`: `id`, `user_id`, `name` (pozostałe jak obecnie)

### Konflikty nazwy

Najprostsza opcja (preferowana):

- Jeśli `name` koliduje (unique per-user), backend zwraca **409** i komunikat: „Notebook name already exists, please rename and try again.”

(Nie implementujemy automatycznego `(...2)` w MVP.)

### Kopiowanie fraz

Dla każdej wejściowej frazy tworzysz nowy rekord w `phrases`:

- `id`: nowy UUID
- `notebook_id`: nowy notebook
- `position`: 10, 20, 30, ...
- `en_text`: skopiowane
- `pl_text`: skopiowane
- `difficulty`: `null`
- `tokens`: skopiowane z źródła (jeśli istnieją, w przeciwnym razie `null`)

## Zachowanie audio

- Snapshot nie ma audio po utworzeniu.
- Użytkownik może później uruchomić standardowe „Generate audio” dla tego notebooka.

## Kryteria akceptacji (Definition of Done)

1. Z poziomu `NotebookView` mogę zaznaczyć N fraz i kliknąć “Snapshot selected”.
2. Powstaje nowy notebook o nazwie `[Snap_YYMMDD] <Źródło>`.
3. Nowy notebook zawiera dokładnie N nowych fraz (inne `id`) z tym samym `en_text/pl_text`.
4. W nowym notebooku:
   - `difficulty` jest `null` dla każdej skopiowanej frazy
   - `tokens` są skopiowane z źródła (jeśli istniały w źródle)
   - `position` jest rosnące w krokach co 10 zgodnie z kolejnością wysłaną przez UI.
5. Po sukcesie aplikacja automatycznie przechodzi na widok nowego notebooka.
6. Błędy walidacji (np. 0 fraz, >100) są komunikowane użytkownikowi jasno i bez crasha UI.

## Lista miejsc w kodzie, które prawdopodobnie będą dotknięte (pod implementatora)

- UI:
  - `src/components/NotebookView.tsx` (dodanie przycisku + call do API; wykorzystanie `selectedPhraseIds`)
- API:
  - nowy route w `src/pages/api/notebooks/snapshots.ts` (lub podobny zgodnie ze stylem repo)
- Typy:
  - `src/types.ts` (DTO/command/response dla snapshotu)
