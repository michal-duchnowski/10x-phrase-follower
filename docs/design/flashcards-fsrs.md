# Phrase Follower - Flashcards / FSRS Design Draft

Status: initial design draft, no implementation yet.

## Confirmed Decisions

- `Remove from Flashcards` should archive/disable the flashcard and preserve FSRS state/history for possible reactivation.
- Deleting a `Phrase` may remove active flashcard state, but historical review rows should remain as snapshots where technically practical.
- Do not add a separate alternatives table in v1; use contains-style matching on the current `Phrase` text.
- After checking an answer, the user selects the FSRS rating using explicit English buttons: `Again`, `Hard`, `Good`, `Easy`.
- The session builder may defer one direction of a new phrase when needed to avoid placing both directions too close together.

## 1. Current Application Analysis

Phrase Follower is an Astro 5 + React 19 + TypeScript app backed by Supabase. The existing domain is centered on notebooks and phrases:

- `notebooks` own ordered `phrases`.
- `phrases` store `en_text`, `pl_text`, `tokens`, `difficulty`, and `learning_hint_markdown`.
- audio is not embedded in `phrases`; it is represented by `audio_segments` per `phrase_id`, `voice_slot`, and `build_id`, with MP3 files in Supabase Storage under `audio/{userId}/{notebookId}/{phraseId}/{voice}.mp3`.
- Learn mode is a per-notebook page at `/notebooks/[id]/learn`.
- top-level navigation currently has `Notebooks`, `Import`, and `Settings`.

Existing Learn mode is useful but intentionally lightweight:

- it loads a `learn-manifest` with phrase data and audio availability;
- it fetches a `playback-manifest` for signed audio URLs;
- it supports `en_to_pl` and `pl_to_en`;
- it uses active answer input via textarea, optional word bank, and speech recognition;
- answer checking is mostly local, using `normalizeAnswerText`, `compareAnswers`, and `compareWordBankAnswer`;
- session state, rounds, retry counts, skips, and correctness are in frontend memory;
- no persistent review history exists.

Important implication: Flashcards can reuse parts of Learn UI and audio-loading ideas, but cannot reuse Learn's state model as-is. Flashcards needs durable backend state and a transaction around every scheduled review.

Current NotebookView already has the right selection primitive:

- `selectedPhraseIds: Set<string>`;
- select all / row checkbox / quick select;
- batch actions such as bulk difficulty update, snapshot, delete selected, and Learn selected.

This is the natural integration point for `Add to Flashcards`.

Current delete behavior:

- `DELETE /api/phrases/[phraseId]` verifies ownership;
- deletes phrase MP3 files from Supabase Storage;
- deletes the `phrases` row;
- `audio_segments` disappear by `ON DELETE CASCADE`.

Flashcards should follow the same ownership pattern and use DB cascades to avoid orphaned learning state.

## 2. Proposed Product Shape

Flashcards should be a top-level independent module:

- route: `/flashcards`;
- topbar item: `Flashcards`;
- component: `FlashcardsView`;
- API namespace: `/api/flashcards/...`;
- service layer: `src/lib/flashcards.service.ts` and `src/lib/fsrs.service.ts`.

Roles stay separate:

- Notebook organizes material.
- Learn is immediate session-based practice for a notebook or selection.
- Flashcards is long-term retention for explicitly selected phrases.

Adding a phrase to Flashcards adds it to a queue. It does not necessarily start learning immediately.

## 3. User Flow

### Add to Flashcards

1. User opens a notebook or smart list.
2. User selects one or more phrases.
3. Existing selected-action bar shows `Add to Flashcards`.
4. Client calls `POST /api/flashcards/add` with `phrase_ids`.
5. Backend verifies that all phrases belong to the authenticated user.
6. Backend creates flashcard membership rows for phrases not already present.
7. Backend creates two direction-state rows per newly added phrase:
   - `en_to_pl`
   - `pl_to_en`
8. Existing phrases already in Flashcards are skipped idempotently.
9. UI toast reports counts:
   - added;
   - already present;
   - failed/not accessible if applicable.

For batch add, the operation should be idempotent and bounded similarly to current bulk update, e.g. max 500 phrase IDs.

### Flashcards Landing

`/flashcards` should show a compact work surface, not a dashboard-heavy page:

- due reviews available now;
- overdue count;
- new phrases waiting;
- current daily/default settings:
  - `New words per day`;
  - `Reviews per session/day`;
- primary action: `Start session`;
- secondary actions:
  - `Manage flashcards`;
  - simple settings.

No large statistics dashboard in v1.

### Daily Session

1. User clicks `Start session`.
2. Backend builds a session batch.
3. Reviews due/overdue are selected first.
4. New phrases are added only after review capacity/backlog rules allow it.
5. Session has a fixed finite card list and displays progress, e.g. `12 cards remaining`.
6. User answers each card by typing.
7. UI checks the answer and shows feedback.
8. User can accept the suggested result or override it when ambiguous/wrong.
9. Backend records the review and updates the FSRS state for that direction.
10. Session ends with `Daily session completed`.
11. User may click `Learn more`, which requests another batch for the same day.

Daily limits are therefore batch sizes, not hard daily ceilings.

## 4. Reuse from Existing App

### From Notebook

Reuse:

- selection state and selected-action bar pattern;
- phrase ownership validation style from bulk update;
- existing phrase list and smart-list awareness;
- confirmation pattern for destructive operations.

Add:

- `Add to Flashcards` button in selected-action bars;
- optional per-row indicator that phrase is already in Flashcards;
- later: `Remove from Flashcards` in row/bulk actions.

### From Learn

Reuse:

- card layout concepts: prompt, answer input, feedback state, next card;
- `LearnDirection` shape, probably promoted/reused as a shared `StudyDirection`;
- `normalizeAnswerText`;
- `AnswerDiffView`;
- `PhraseTokenPills`;
- optional speech recognition later, not required in Flashcards v1;
- auto-advance option could be reused after the FSRS write succeeds.

Do not reuse unchanged:

- frontend-only session correctness state;
- "rounds with incorrect phrases";
- current `difficulty` marking as a substitute for FSRS rating;
- current `compareAnswers` as final correctness logic, because Flashcards needs a review-focused checker and explicit FSRS rating buttons.

### Audio / TTS

Reuse:

- existing `audio_segments`;
- existing storage paths;
- existing `playback-manifest` signed URL strategy;
- English voice slot selection priority `EN1`, fallback `EN2`, `EN3`;
- no duplicate TTS generation.

Flashcards should only read existing audio in v1. If audio is missing, the card remains usable.

Audio timing:

- `en_to_pl`: auto-play English audio before answering, because English is the prompt.
- `pl_to_en`: do not play English audio before answering, because it gives away the answer. Play English audio only after the answer is checked/saved or as part of feedback.
- Polish audio is not central to the requirement. It can remain optional; if used for `pl_to_en`, it must be treated as prompt audio and must not reveal English.

## 5. Domain Model

### Phrase

Existing source of learning content:

- English text;
- Polish text;
- tokens;
- learning hint;
- difficulty label;
- audio via `audio_segments`.

Phrase remains editable and deletable through the existing app.

### Flashcard

A Flashcard is user enrollment of one existing `Phrase` into spaced repetition.

It does not copy `en_text` or `pl_text`.

It stores:

- ownership/user;
- `phrase_id`;
- status: active/archived;
- timestamps for add/archive;
- optional source notebook snapshot for diagnostics only if needed later.

### Direction

Each Flashcard has two independent direction states:

- `en_to_pl`;
- `pl_to_en`.

Each direction is its own FSRS card. This is the unit that has:

- due date;
- FSRS state;
- repetitions/lapses;
- last review;
- learning/relearning state.

The phrase-level new limit counts phrases, not direction rows. Starting one new phrase normally introduces both directions into learning on the same day, but after that they schedule independently.

### Review Event

Every submitted card answer creates an immutable review log row.

It records:

- which flashcard direction was reviewed;
- when;
- prompt and expected answer snapshots;
- user answer;
- match result/suggestion;
- final user-confirmed FSRS rating;
- prior and resulting FSRS state enough for audit/rebuild.

History should survive resets and remove-from-flashcards unless the phrase itself is deleted and product decides hard deletion is acceptable.

## 6. Minimal Data Model

Recommended new enums:

```sql
create type flashcard_direction_enum as enum ('en_to_pl', 'pl_to_en');
create type flashcard_status_enum as enum ('active', 'archived');
create type fsrs_card_state_enum as enum ('New', 'Learning', 'Review', 'Relearning');
create type fsrs_rating_enum as enum ('Again', 'Hard', 'Good', 'Easy');
create type answer_match_kind_enum as enum ('exact', 'contains', 'typo', 'incorrect', 'manual');
```

Recommended tables:

```sql
create table flashcards (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  phrase_id uuid not null references phrases(id) on delete cascade,
  status flashcard_status_enum not null default 'active',
  added_at timestamptz not null default now(),
  archived_at timestamptz null,
  unique (user_id, phrase_id)
);
```

```sql
create table flashcard_directions (
  id uuid primary key,
  flashcard_id uuid not null references flashcards(id) on delete cascade,
  direction flashcard_direction_enum not null,

  fsrs_state fsrs_card_state_enum not null default 'New',
  due_at timestamptz not null default now(),
  stability double precision not null default 0,
  difficulty double precision not null default 0,
  scheduled_days integer not null default 0,
  elapsed_days integer not null default 0,
  learning_steps integer not null default 0,
  reps integer not null default 0,
  lapses integer not null default 0,
  last_review_at timestamptz null,
  reset_at timestamptz null,

  unique (flashcard_id, direction)
);
```

```sql
create table flashcard_reviews (
  id uuid primary key,
  flashcard_direction_id uuid null references flashcard_directions(id) on delete set null,
  flashcard_id uuid null references flashcards(id) on delete set null,
  phrase_id uuid null references phrases(id) on delete set null,
  user_id uuid not null references users(id) on delete cascade,
  direction flashcard_direction_enum not null,

  reviewed_at timestamptz not null default now(),
  fsrs_rating fsrs_rating_enum not null,
  answer_match_kind answer_match_kind_enum not null,
  user_answer text null,
  expected_answer text not null,
  prompt_text text not null,

  previous_card jsonb not null,
  next_card jsonb not null,
  fsrs_log jsonb not null
);
```

```sql
create table flashcard_settings (
  user_id uuid primary key references users(id) on delete cascade,
  new_phrases_per_batch integer not null default 5,
  review_cards_per_batch integer not null default 50,
  request_retention double precision not null default 0.9,
  updated_at timestamptz not null default now(),
  check (new_phrases_per_batch between 0 and 100),
  check (review_cards_per_batch between 1 and 500),
  check (request_retention between 0.7 and 0.98)
);
```

Notes:

- `flashcard_reviews.phrase_id` uses `on delete set null` to preserve history after phrase deletion. This creates no active orphaned flashcard because active state is cascaded through `flashcards`; only historical logs remain.
- `expected_answer` and `prompt_text` snapshots protect review history when the phrase text changes later.
- `previous_card`, `next_card`, and `fsrs_log` are JSON by design because they mirror library data and avoid schema churn. The query-critical state lives in `flashcard_directions`.
- RLS should follow the existing owner-only pattern using `user_id` directly on `flashcards`, `flashcard_settings`, and `flashcard_reviews`, and ownership joins for directions.

Indexes:

- `flashcard_directions(due_at)` filtered/joined by active user cards;
- `flashcards(user_id, status)`;
- `flashcards(user_id, phrase_id)` unique;
- `flashcard_reviews(user_id, reviewed_at desc)`.

## 7. FSRS Integration

Recommended library: `ts-fsrs`.

Reasons:

- the app is TypeScript/Node;
- `.nvmrc` uses Node 22.14.0;
- `ts-fsrs` is the scheduler package for review flows;
- it supports FSRS v6, card states `New`, `Learning`, `Review`, `Relearning`, and ratings `Again`, `Hard`, `Good`, `Easy`;
- it exposes `createEmptyCard`, `fsrs()`, `repeat()` for previews, and `next()` for applying a rating.

Do not add `@open-spaced-repetition/binding` in v1. It is useful for parameter optimization and learning-step recommendation from review logs, but v1 has no historical data to train on.

Recommended scheduler config for v1:

```ts
fsrs({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
})
```

This should be confirmed during implementation against the exact installed `ts-fsrs` version. The important point is to use the library's own learning/relearning mechanism rather than inventing a custom lapse flow.

### State Mapping

Each `flashcard_directions` row maps to a `ts-fsrs` Card:

- `due_at` -> `due`;
- `stability`;
- `difficulty`;
- `elapsed_days`;
- `scheduled_days`;
- `learning_steps`;
- `reps`;
- `lapses`;
- `fsrs_state` -> `state`;
- `last_review_at` -> `last_review`.

For a never-started direction, initialize from `createEmptyCard(now)` or persist equivalent defaults.

On review:

1. Load direction row and phrase.
2. Build Card from row.
3. Determine final FSRS rating.
4. Call `scheduler.next(card, reviewedAt, rating)`.
5. Save returned `card` to `flashcard_directions`.
6. Insert returned `log` plus app answer metadata into `flashcard_reviews`.

This write should be atomic.

### Answer to Rating

The answer checker should give feedback, but the final FSRS rating should be selected by the user with explicit buttons. There should be no hidden auto-rating and no attempt to infer the user's memory state irreversibly from string similarity.

Recommended v1 flow:

1. User types an answer.
2. User clicks `Check answer`.
3. UI shows:
   - user's answer;
   - current expected answer from the referenced `Phrase`;
   - diff / match feedback;
   - optional note that the answer appears exact, contains one of the accepted phrase parts, has a likely typo, or is incorrect.
4. User chooses one of the FSRS rating buttons:
   - `Again`;
   - `Hard`;
   - `Good`;
   - `Easy`.
5. Backend records the selected rating and updates FSRS.

The matcher can make the UI faster to understand, but it does not decide the rating. This keeps user control simple and aligns with FSRS: the app supplies one explicit rating to the scheduler.

### Fuzzy Matching

Create a new answer-checking service rather than overloading Learn's exact comparison:

```ts
type AnswerCheckResult = {
  kind: "exact" | "contains" | "typo" | "incorrect";
  normalizedUser: string;
  normalizedExpected: string;
};
```

Proposed behavior:

- normalize using existing `normalizeAnswerText`;
- compare against the current answer text from the referenced `Phrase`;
- support contains matching on the current phrase text, similar to Learn's `contains mode`;
- exact match -> show exact feedback;
- contains match -> show that one of the current accepted phrase parts matched;
- minor edit distance -> show likely typo feedback;
- large mismatch -> show incorrect feedback.

Important: the app gives feedback only. FSRS receives the final button-selected rating.

### Alternative Answers

Do not add a separate alternatives table in v1.

Flashcards should reference existing `Phrase` data and interpret the current answer text directly. If `pl_text` or `en_text` contains multiple acceptable forms, the checker can use contains-style matching against that current phrase value. This keeps the model simple and avoids copying phrase data into a flashcard-specific answer store.

## 8. Session-Building Algorithm

Inputs:

- `new_phrases_per_batch`, default 5;
- `review_cards_per_batch`, default 50;
- now;
- active flashcards;
- due directions;
- new phrase pool.

Definitions:

- New direction: `fsrs_state = New` and `reps = 0`.
- New phrase: active flashcard where both directions are still new.
- Review: direction with `fsrs_state != New` and `due_at <= now`.
- Overdue: review with `due_at < start_of_today` or simply `due_at <= now` with age priority.

Priority:

1. due/overdue reviews;
2. learning/relearning steps due now;
3. new phrases, if review pressure allows;
4. no artificial mutation of FSRS due dates.

Backlog rule:

- Build up to `review_cards_per_batch` review cards first.
- If selected reviews fill the batch, add zero new phrases.
- If reviews are below the review batch, add new phrases up to `new_phrases_per_batch`.
- If total overdue reviews are much larger than the review batch, e.g. `overdue > 2 * review_cards_per_batch`, suppress new phrases for that batch.

This naturally pauses new material during heavy backlog without changing FSRS state.

New phrase expansion:

- selecting 5 new phrases creates up to 10 session cards;
- both directions may start in same batch;
- after first review they are independent.

Ordering:

- reviews sorted by due urgency first, then randomized within close due buckets;
- new phrase cards mixed after initial reviews unless backlog is empty;
- never place both directions of the same phrase adjacent;
- ideally maintain at least 3 cards between directions of the same phrase;
- if the session is too small to satisfy spacing, prefer only one direction of a phrase in that batch, or put the second at the end with a warning-free best effort.

`Learn more`:

- calls the same batch builder with `mode=additional`;
- it should exclude cards already completed in the current UI session unless they became due again through FSRS learning/relearning steps;
- it may take the next review slice and next new phrase slice.

## 9. Wrong Answer / Relearning

Do not invent a custom "show again later" system.

Use FSRS rating `Again` and the library's state transition:

- if the card was `Review`, `Again` moves it into relearning when short-term mode/relearning steps are enabled;
- `lapses` increments through FSRS behavior;
- due may become minutes later depending on `relearning_steps`;
- session builder can include learning/relearning cards due now or later when the user clicks `Learn more`.

For a finite daily session:

- after `Again`, record immediately;
- do not automatically reinsert into the same fixed list unless the returned due time is already within the current session policy;
- after session completion, `Learn more` can pick up any learning/relearning cards that are due.

This keeps the session finite while respecting FSRS.

## 10. Lifecycle and Deletion

### Remove from Flashcards

Preferred behavior: archive, not hard delete.

- `flashcards.status = archived`;
- `archived_at = now()`;
- direction rows remain for history/re-add continuity;
- review logs remain;
- archived cards are excluded from session building.

Re-add:

- if archived row exists, set `status = active`, clear `archived_at`;
- keep previous direction state by default;
- offer a separate `Reset` if the user wants to restart.

Alternative: re-add as new. This loses useful memory history and should not be default.

### Delete Phrase

When deleting a phrase that is in Flashcards, UI should warn:

`Removing this phrase will also remove its active flashcards, FSRS state, review links, generated audio, and audio metadata. Historical review rows may remain as anonymized snapshots.`

Actual list should match implementation:

- phrase row deleted;
- flashcard and direction rows cascade;
- audio segment rows cascade;
- MP3 files are deleted by existing storage cleanup;
- review history row can preserve text/rating snapshots with `phrase_id = null`.

If product prefers full deletion of review history on phrase delete, use `on delete cascade` instead of `set null`, but that conflicts with the stated preference to preserve history when possible.

### Reset Direction

Use FSRS-provided reset/forget semantics where appropriate. In `ts-fsrs`, `forget(card, now, reset_count?)` exists for forgetting a card. For product reset, the simpler behavior is:

- direction returns to `New`;
- due is set to now;
- stability/difficulty/reps/lapses/learning_steps reset to empty-card defaults;
- `reset_at = now`;
- review history remains.

Insert an optional review log/event for reset later if auditability matters.

### Reset Phrase

Perform Reset Direction for both `en_to_pl` and `pl_to_en`.

## 11. Phrase Edits After Learning Starts

Phrase text remains source of truth for future cards, but history should keep snapshots.

If user edits `en_text` or `pl_text`:

- future prompts/answers use new text;
- previous review logs keep old prompt/expected snapshots;
- contains-style matching follows the current `Phrase` text, so phrase edits immediately change what the checker considers acceptable.

Recommended v1 behavior:

- show no blocking warning on normal edits;
- in Flashcards management, mark phrase as "changed since last review" if `phrases.updated_at > flashcard_directions.last_review_at`;
- offer reset direction if the edit substantially changes the answer.

## 12. Refresh / Interrupted Session

Session list can be rebuilt from backend state. Since FSRS writes happen per answer, losing frontend state is acceptable.

Important edge:

- answer checked but session closed before next card loads.

Solution:

- when user confirms/saves rating, backend commits review before UI advances;
- if commit succeeds and UI closes, progress is preserved;
- if commit fails, remain on feedback state and show retry.

Avoid creating persistent `flashcard_sessions` in v1 unless refresh-resume becomes a priority. A stateless batch plus per-card durable writes is simpler.

## 13. API Shape

Suggested endpoints:

- `POST /api/flashcards/add`
  - body: `{ phrase_ids: string[] }`
  - response: `{ added, already_present }`

- `GET /api/flashcards/overview`
  - counts and settings for landing page

- `PATCH /api/flashcards/settings`
  - update new/review batch settings

- `POST /api/flashcards/session`
  - builds a finite session batch
  - optional body: `{ completed_direction_ids?: string[], mode?: "daily" | "more" }`

- `POST /api/flashcards/reviews`
  - records one answer and FSRS rating atomically
  - body includes `flashcard_direction_id`, `user_answer`, `answer_match_kind`, `fsrs_rating`, optional timing metadata

- `POST /api/flashcards/[flashcardId]/archive`
  - remove from Flashcards without deleting Phrase

- `POST /api/flashcards/directions/[directionId]/reset`

- `POST /api/flashcards/[flashcardId]/reset`

## 14. Edge Cases

- Re-adding same phrase: idempotent; archived row reactivates.
- Batch add with duplicates: de-dupe before DB writes.
- Phrase inaccessible in batch: fail whole request with validation, or return per-ID status. Existing bulk update fails validation; use same style unless partial success is preferred.
- Delete Phrase with flashcard: warning before deletion; cascades active state.
- Remove from Flashcards: archive and keep history.
- Reset one direction: only that FSRS card returns to New.
- Reset phrase: both directions return to New.
- Multiple acceptable answers in current phrase text: answer checker uses contains-style matching on the current `Phrase.en_text` or `Phrase.pl_text`.
- Typo: show diff and accept/override path.
- Ambiguous answer: no automatic irreversible FSRS write until user chooses.
- Several weeks without learning: overdue backlog shown honestly; session slices it.
- Huge backlog: reviews fill batch; new phrases suppressed naturally.
- No new phrases: session consists of reviews only.
- No reviews: introduce new phrases up to batch size.
- No reviews and no new phrases: empty-state message.
- Learn more: request another batch; limits apply again as batch sizes.
- Both directions same phrase: spacing algorithm separates or defers one.
- Phrase changed after learning: use new text, preserve review snapshots.
- Missing audio: no blocking; show no-audio state quietly.
- Signed URL expired during long session: refetch playback manifest or lazy-fetch by phrase.
- Review write fails: do not advance; let user retry.
- User closes after write succeeds: state is preserved.

## 15. Implementation Phases

Phase 1:

- schema and RLS;
- `ts-fsrs` integration service;
- add-to-flashcards from Notebook;
- `/flashcards` landing and finite session;
- typed answers, exact/contains/typo feedback, explicit FSRS rating buttons;
- review recording and state update;
- basic settings.

Phase 2:

- management view;
- remove/archive and reset UX;
- better phrase-changed indicators.

Phase 3:

- stats and difficult-word analysis;
- optimizer/parameter tuning from review logs;
- richer session resume if needed.

## 16. Decisions to Confirm

1. Should Polish audio ever play before `pl_to_en`, or should Flashcards only auto-play English audio before/after according to answer-reveal safety?

## Sources Checked

- Local code: `src/components/NotebookView.tsx`, `src/components/LearnView.tsx`, `src/lib/learn.service.ts`, `src/lib/word-bank.service.ts`, `src/pages/api/notebooks/[notebookId]/learn-manifest.ts`, `src/pages/api/notebooks/[notebookId]/playback-manifest.ts`, `src/pages/api/phrases/[phraseId].ts`, Supabase migrations.
- FSRS library docs: `ts-fsrs` README and source from `open-spaced-repetition/ts-fsrs`.
