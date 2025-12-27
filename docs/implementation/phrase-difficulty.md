# Phrase difficulty (easy/medium/hard) + filtering (Notebook/Player/Learn)

## Summary

Add a **single difficulty marker per phrase** to allow:

- Filtering playback to only selected difficulties (e.g. **only hard**)
- Filtering Learn mode sessions to only selected difficulties
- Fast marking from **Player** and **Notebook**, and optionally from **Learn** (keyboard-driven, minimal UI clutter)

Difficulty is **per phrase within a notebook** (stored on the `phrases` row).

## Goals

- **Reduce noise** in large notebooks by allowing quick isolation of “hard” phrases.
- Provide **3 levels** instead of a single “favourite”: `easy / medium / hard`.
- Keep existing data valid: old phrases become effectively **`unset`** by default.
- Make marking fast where it matters:
  - Player: single phrase, rapid toggling via keyboard
  - Notebook: bulk marking (multi-select)
  - Learn: optional, minimal UI; keyboard shortcuts are primary

## Non-goals (for MVP)

- Spaced repetition / auto-adjusting difficulty based on performance
- Multi-tagging (one phrase having multiple labels)
- Export/import of difficulty in text files
- “Dynamic notebooks” implemented as real notebooks with copied phrases
- Any change to audio generation pipeline: **difficulty must not affect TTS generation**

## Terminology

- **difficulty**: one of `easy | medium | hard` or **unset**
- **unset**: “not assessed yet”, not “medium”
- **Smart list / saved view**: a query-driven view like “All hard phrases across notebooks” (not a physical notebook)

## Core assumptions / decisions (explicit)

### One marker per phrase

- A phrase can have **at most one** difficulty marker.
- Rationale: simplest UX, easiest filtering, minimal DB complexity.

### 3 levels + unset

- Levels: `easy`, `medium`, `hard`
- Default: **unset**

### Storage: `NULL = unset`

- DB column `phrases.difficulty` is **nullable**.
- `NULL` is treated as **unset** everywhere.
- Only allowed non-null values: `easy | medium | hard`.

Rationale: simplest migration (no backfill), preserves “unknown” state cleanly.

### Where marking happens

- Notebook: **bulk + per-row**
- Player: **per current phrase** (fast)
- Learn: **optional** (primary is keyboard; mobile gets a small popover)

### Filtering behavior

- MVP uses **hard filters** (“play only hard”).
- Filtering should be **persisted per-user** (prefer: localStorage first, later DB preference).

## Database changes (Supabase)

### Schema

Add column on `phrases`:

- `difficulty text null`
- Check constraint: `difficulty in ('easy','medium','hard')` when not null

### Indexing

Add a composite index to keep filtered listing fast:

- `(notebook_id, difficulty, position)`

Rationale: main query pattern is “phrases for notebook, ordered by position, optionally filtered by difficulty”.

### Migration complexity (existing data)

If `difficulty` is nullable and `NULL = unset`, existing rows require **no updates**.

Migration is essentially:

- `ALTER TABLE phrases ADD COLUMN difficulty ...`
- `ALTER TABLE phrases ADD CONSTRAINT ...`
- `CREATE INDEX ...`

No backfill required.

### RLS

No RLS changes required:

- `phrases` already uses notebook ownership policies.
- Adding a column doesn’t change ownership logic.

## Shared types (TypeScript)

Update `src/types.ts`:

- Add `export type PhraseDifficulty = "easy" | "medium" | "hard";`
- Add a DTO-level type representing the 4-state UI value:
  - `export type PhraseDifficultyOrUnset = PhraseDifficulty | "unset";`

Update `PhraseDTO` to include `difficulty`:

- From DB: `difficulty: PhraseDifficulty | null`
- In UI: map `null -> "unset"` where needed

Update commands:

- `UpdatePhraseCommand`: include optional `difficulty?: PhraseDifficulty | null`
  - `null` clears difficulty (sets to unset)
  - missing means “no change”

`CreatePhraseCommand`:

- Keep default as unset (`difficulty` omitted / null)
- Optionally allow setting on create (not required for MVP)

## API changes (Astro endpoints)

### List phrases in notebook

File: `src/pages/api/notebooks/[notebookId]/phrases/index.ts`

Add:

- Response select includes `difficulty`
- Optional query param(s) for filtering by difficulty:
  - `difficulty=hard` (single)
  - optionally later: `difficulty=medium,hard`

MVP suggestion:

- Support **single** difficulty filter + support `unset` via `difficulty=unset` (translated to `is null`).

### Update phrase

File: `src/pages/api/phrases/[phraseId].ts`

Add to PATCH:

- Accept `difficulty`:
  - `"easy" | "medium" | "hard"` sets value
  - `null` clears (unset)
- Validate allowed values; reject everything else
- Include `difficulty` in response select

### Bulk update (optional but recommended for usability)

Add a new endpoint under notebook scope (recommended):

- `POST /api/notebooks/:notebookId/phrases/bulk-update`
- Body:
  - `{ phrase_ids: UUID[], difficulty: PhraseDifficulty | null }`
- Server-side checks:
  - size limit (e.g. max 100–500 ids)
  - verify ownership by notebook + phrase set membership

Rationale: enables “select many → mark hard” in Notebook without N PATCH calls.

## UI/UX changes

### Notebook view

Goals:

- Make it easy to **bulk mark** and **filter**.

Minimum UX:

- **Per phrase indicator** (e.g. badge/label): Unset/Easy/Medium/Hard
- **Quick filter**: All / Unset / Easy / Medium / Hard / Medium+Hard
- **Bulk actions** when multiple phrases selected:
  - Set difficulty: Easy / Medium / Hard / Unset

Notes:

- “Unset” is a first-class filter because it’s the state for all existing data initially.

### Player

Goals:

- Let user quickly mark current phrase difficulty without leaving playback.
- Allow filtering playback to a subset.

UX:

- **Filter** (persisted):
  - All
  - Hard
  - Medium+Hard
  - Unset
  - Easy (optional)
- **Marking shortcuts** (desktop):
  - `1` → Easy
  - `2` → Medium
  - `3` → Hard
  - `0` → Unset (clear)

Notes:

- Ensure shortcuts don’t conflict with existing player shortcuts (Space/K/S/R/Arrows/P/N etc).
- On-screen hint can be subtle (tooltip or small “Keyboard shortcuts” help).

### Learn

Decision: Learn marking is supported but kept **low-clutter**.

Desktop:

- No extra buttons by default.
- Enable the same shortcuts:
  - `1/2/3/0`
- Add a small help hint (e.g. in shortcuts dialog or a subtle caption).

Mobile:

- Add a small **“Difficulty”** action (popover/bottom sheet) with:
  - Easy / Medium / Hard / Unset

Learn filtering:

- Same filter presets as Player (persisted).
- Filter affects which phrases are included in the session.

## Smart lists (dynamic views) – phased

### Phase (recommended after MVP)

Implement a “Smart list” like:

- **Hard (All notebooks)**: shows all phrases where `difficulty = hard` across user’s notebooks.

Implementation guidance:

- It should be a **query-driven view**, not a new “notebook” with copied phrases.
- Audio generation remains per original notebook/phrase; smart list does **not** own audio.

API approach (one of):

- Add `GET /api/phrases?difficulty=hard` (scoped to current user via RLS)
- Or add `GET /api/smart-lists/hard` returning phrase + notebook metadata

## Audio generation / export ZIP (explicitly unchanged)

- Difficulty changes must **not**:
  - trigger audio regeneration
  - change `build` logic
  - affect segment selection

Reason: difficulty is a study/playback filter only; TTS audio is tied to phrase text + voice configuration.

## Edge cases & rules

- **Default for existing data**: `difficulty = NULL` → shown as **Unset**
- **Filtering + empty result**:
  - Player: show a clear message (“No phrases match filter”) and offer “Reset filter to All”
  - Learn: same; don’t start session with 0 cards
- **Reorder**: difficulty unaffected
- **Import**: difficulty remains unset (do not parse tags)
- **Delete phrase**: normal behavior (difficulty column irrelevant)
- **Validation**:
  - Only allow `easy|medium|hard|null`
  - Reject other strings

## Acceptance criteria (MVP)

- Can mark a phrase difficulty from **Player** using `1/2/3/0`.
- Can filter **Player playback** to only phrases matching selected difficulty preset.
- Can filter **Learn** session to selected difficulty preset.
- Can bulk mark difficulty in **Notebook** (select multiple → set hard).
- Existing notebooks still load correctly; all existing phrases appear as **Unset**.
- No changes to audio generation behavior.

## Implementation checklist (for next agent)

- DB migration: add nullable `phrases.difficulty` + check constraint + index
- Regenerate `src/db/database.types.ts`
- Update `src/types.ts` DTOs/commands
- Update API:
  - include `difficulty` in selects
  - accept/validate PATCH `difficulty`
  - implement bulk update endpoint (recommended)
  - implement list filter param (recommended)
- Update UI:
  - Notebook: display + filter + bulk set
  - Player: filter + keyboard shortcuts + PATCH
  - Learn: filter + keyboard shortcuts (+ mobile popover)
- Persist filter selection (localStorage)
