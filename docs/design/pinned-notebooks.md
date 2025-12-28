# Pinned notebooks + Smart Hard “Only pinned” (Design)

## Goals

- Reduce friction when the user is actively working with 2–3 notebooks across desktop + mobile.
- Keep the current Smart Lists (All Easy/Medium/Hard), but allow narrowing **Hard** to a user-chosen subset.
- Keep UX low-friction: no extra navigation, minimal taps, fast list scanning on mobile.

## Non-goals

- No new backend “folder/tag” taxonomy.
- No changes to phrase difficulty semantics.
- No automatic “recents” logic in this design (can be added later as an independent feature).

## Current behavior (baseline)

- “Smart Lists” are **virtual notebooks** identified by IDs:
  - `difficulty-easy`, `difficulty-medium`, `difficulty-hard`
- In `src/components/NotebookList.tsx`, virtual notebooks are **prepended** to the notebook list:
  - `allNotebooks = [...virtualNotebooks, ...notebooks]`
- Therefore, on the default “All” view, Smart Lists always appear **first**.

## Proposed features

### 1) Pinned notebooks

#### User story

As a user, I want to pin 2–5 notebooks I’m actively learning so they are always easy to access without searching or scrolling.

#### UX overview

- Notebook list page (`/notebooks`) shows a dedicated **Pinned** section.
- Each notebook tile has a **pin toggle** (icon button).
- Pinned notebooks are displayed:
  - **At the top** of the list, inside their own section.
  - Not duplicated in the “All notebooks” section (recommended) OR duplicated (optional; see “Variants”).

#### Visual design (desktop)

- Section header row:
  - Title: **Pinned**
  - Subtitle (optional): “Quick access to notebooks you’re learning now”
  - Right side (optional): count pill (e.g. “3”)
- Layout:
  - Same grid as notebooks (1 col mobile, 2–3 cols desktop).
  - If empty: collapsed by default (no header), or show a subtle empty-state card:
    - “Pin notebooks to keep them on top.”

#### Visual design (mobile)

- Pinned section should appear immediately after search, before filters.
- Ensure pin icon hit area is at least 44×44 CSS px.
- Keep pinned tiles compact; avoid additional actions crowding.

#### Interaction details

- Pin toggle is available:
  - On notebook tile (list view).
  - (Optional) On notebook detail page header (`/notebooks/:id`) for convenience.
- Pinning is instant (optimistic UI), with rollback on error.
- Accessibility:
  - Button has `aria-pressed`
  - Label: “Pin notebook” / “Unpin notebook”

#### Data model (minimal)

- Store pinned notebook IDs per user.
- Recommended persistence:
  - **Server-side per user** (preferred): survives device changes and is consistent across desktop/mobile.
  - If server-side is not available, fallback to localStorage (lower priority).

**Suggested schema (server-side):**

- Table: `pinned_notebooks`
  - `user_id` (FK)
  - `notebook_id` (FK)
  - `created_at`
  - Unique constraint: (`user_id`, `notebook_id`)

#### API surface (conceptual)

- `GET /api/pins` → `{ items: { notebook_id, created_at }[] }`
- `POST /api/pins` body `{ notebook_id }` → 201
- `DELETE /api/pins/:notebookId` → 204

_(Exact endpoints can be adapted to existing patterns.)_

#### Sorting and limits

- Pinned list ordering:
  - Default: by `created_at desc` (newest pinned first), or by notebook `updated_at desc`.
  - Keep stable ordering to reduce “UI jumping”.
- Soft limit:
  - Recommend warning after 12 pins (“Too many pins reduces usefulness”), but do not hard-block.

---

### 2) Smart → Hard filter: “Only pinned”

#### User story

As a user, when I open Smart List “All Hard”, I want a quick toggle to show only hard phrases coming from my pinned notebooks.

#### UX overview

- On virtual notebook view `difficulty-hard`:
  - Add a toggle: **Only pinned notebooks**
  - Default state: **OFF** (matches your preference)
  - State persistence: localStorage (per device) OR URL param (shareable) or both.

#### UI placement

- Desktop: next to existing filter controls (currently virtual notebooks skip difficulty filter).
- Mobile: near the top of the phrase list, as a compact switch:
  - Label: “Only pinned”
  - Secondary text (optional): “Limit Smart list to pinned notebooks”

#### URL behavior (recommended)

- Add query parameter for Smart hard view:
  - `/notebooks/difficulty-hard?pinned=1`
- Benefits:
  - Makes the state explicit and shareable.
  - Keeps behavior deterministic across refresh.

#### Backend / query behavior

Virtual notebook endpoints currently fetch phrases by:

- “all notebooks for this user” + `difficulty = hard`

To support “Only pinned”:

- Replace “all notebook IDs” with “pinned notebook IDs” when `pinned=1`.
- If user has no pinned notebooks:
  - Return empty list with friendly empty state:
    - “No pinned notebooks. Pin a notebook to use this filter.”

#### Edge cases

- If a pinned notebook is deleted:
  - Pins should be cleaned up automatically via FK cascade or handled gracefully.
- If a user unpins a notebook while on Smart Hard with `pinned=1`:
  - UI should refresh; phrases from that notebook disappear.

---

## Smart Lists placement in Notebook List (important UX choice)

Because Smart Lists are currently prepended in `NotebookList`, they always render at the top.

### Decision

We will implement **Variant A**.

### What that means (Variant A)

- In the default “All” view, show **Pinned + regular notebooks only**.
- Smart Lists are accessible only via the **“Smart”** filter chip (not mixed into “All”).

### Rationale

- Reduces visual noise in the primary list when the notebook count grows.
- Keeps Smart Lists discoverable but intentionally accessed (matches the “Hard is my main view” workflow).

### Implementation note (frontend)

- Do **not** prepend virtual notebooks into the `allNotebooks` collection used for the “All” bucket.
- Only include virtual notebooks when the active bucket/filter is “Smart”.

---

## Copy / Labels

- Section: **Pinned**
- Toggle on Smart Hard: **Only pinned**
- Empty pinned state:
  - Title: “Pin notebooks for quick access”
  - Body: “Pinned notebooks always appear at the top of your list.”

---

## Analytics (optional)

- Track:
  - pin/unpin actions
  - usage of Smart Hard `pinned=1`
  - time-to-open notebook (proxy for navigation friction)

---

## Rollout plan (safe)

1. Add pinned persistence + UI in notebook list (no Smart changes).
2. Add Smart Hard `Only pinned` toggle (URL param + persistence).
3. Decide Smart placement in “All” (move Smart into “Smart” filter only, or keep as section).
