# REST API Plan

> **Product:** Phrase Follower (MVP)
> **Stack alignment:** Astro 5 (Node adapter), TypeScript 5, React 19, Tailwind 4, Supabase 2.48.3
> **Auth/RLS:** Supabase Auth (JWT), PostgreSQL RLS as specified in the DB plan

---

## 1. Resources

| Resource                  | Backing table / view                            | Notes                                                                                                          |
| ------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `users`                   | `public.users`                                  | Thin profile tied to `auth.users`. Owner-only RLS.                                                             |
| `notebooks`               | `public.notebooks`                              | Case-insensitive unique `(user_id, name)` via `citext`. Tracks `current_build_id`.                             |
| `phrases`                 | `public.phrases`                                | Ordered by integer `position` (gaps allowed).                                                                  |
| `user-voices`             | `public.user_voices`                            | Four slots per user: `EN1`, `EN2`, `EN3`, `PL`.                                                                |
| `tts-credentials`         | `public.tts_credentials`                        | App-side encrypted key; never returned raw.                                                                    |
| `jobs`                    | `public.jobs`                                   | Long-running ops of type `GENERATE_REBUILD`.                                                                   |
| `builds`                  | `public.builds`                                 | Output container for a job.                                                                                    |
| `audio-segments`          | `public.audio_segments`                         | One per `phrase × voice_slot × build`. `is_active` marks segments belonging to current build (partial unique). |
| `import-logs`             | `public.import_logs`                            | Rows rejected during import with reasons.                                                                      |
| `notebook-audio-statuses` | `public.notebook_audio_statuses` (MV, optional) | Aggregated counts for active build.                                                                            |
| `playback-manifests`      | (derived)                                       | Virtual resource returning signed URLs for active segments per notebook.                                       |

---

## 2. Endpoints

> Base URL examples assume Astro API routes under `/api/*`. All requests require a valid Supabase JWT in `Authorization: Bearer <token>` unless explicitly marked as public.

### Conventions

- **Idempotency:** For any non-safe `POST` that can be retried (imports, job creation), support `Idempotency-Key` header (v4 UUID). Store/lookup per user+route.
- **Pagination:** Cursor-based via `?limit` (default 25, max 100) and `?cursor=<opaque>`. Responses include `next_cursor` when more data exists.
- **Sorting:** Use `?sort=field&order=asc|desc` when offered; default sort described per list.
- **Errors:** JSON `{ "error": { "code": "string", "message": "human readable", "details": {...} } }`.

---

### 2.1 Users

#### GET `/api/users/me`

- **Desc:** Return current user profile.
- **Response 200**

```json
{
  "id": "uuid",
  "created_at": "2025-10-13T12:34:56Z"
}
```

- **Errors:** `401 unauthorized`

---

### 2.2 Notebooks

#### GET `/api/notebooks`

- **Desc:** List notebooks for the authenticated user.
- **Query:** `limit`, `cursor`, `sort=updated_at|created_at|name`, `order=asc|desc`, `q=<name substring (case-insensitive)>`
- **Response 200**

```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Daily deck",
      "current_build_id": "uuid|null",
      "last_generate_job_id": "uuid|null",
      "created_at": "2025-10-12T10:00:00Z",
      "updated_at": "2025-10-13T09:00:00Z"
    }
  ],
  "next_cursor": "opaque|null"
}
```

#### POST `/api/notebooks`

- **Desc:** Create a notebook (empty) or via initial import (see Import section for bulk).
- **Request**

```json
{ "name": "Daily deck" }
```

- **Response 201**

```json
{ "id": "uuid", "name": "Daily deck", "created_at": "...", "updated_at": "..." }
```

- **Errors:** `409 unique_violation` (duplicate name per user), `400 validation_error` (length 1..100)

#### GET `/api/notebooks/:notebookId`

- **Desc:** Get notebook by id.
- **Response 200**

```json
{
  "id": "uuid",
  "name": "Daily deck",
  "current_build_id": "uuid|null",
  "last_generate_job_id": "uuid|null",
  "created_at": "...",
  "updated_at": "..."
}
```

- **Errors:** `404 not_found` (RLS blocks cross-user)

#### PATCH `/api/notebooks/:notebookId`

- **Desc:** Rename notebook.
- **Request**

```json
{ "name": "Evening deck" }
```

- **Response 200** same shape as GET
- **Errors:** `409 unique_violation`, `400 validation_error`

#### DELETE `/api/notebooks/:notebookId`

- **Desc:** Hard delete notebook; cascades phrases, segments, builds, jobs, import logs (DB ON DELETE).
- **Response 204**
- **Errors:** `404 not_found`

---

### 2.3 Phrases

#### GET `/api/notebooks/:notebookId/phrases`

- **Desc:** List phrases in a notebook.
- **Query:** `limit`, `cursor`, `sort=position|created_at`, `order=asc|desc`
- **Response 200**

```json
{
  "items": [
    {
      "id":"uuid",
      "position": 10,
      "en_text":"How are you?",
      "pl_text":"Jak się masz?",
      "tokens": { "en":[...], "pl":[...] },
      "created_at":"...",
      "updated_at":"..."
    }
  ],
  "next_cursor": null
}
```

#### POST `/api/notebooks/:notebookId/phrases`

- **Desc:** Create a single phrase.
- **Request**

```json
{
  "position": 20,
  "en_text": "I'm fine, thanks.",
  "pl_text": "W porządku, dzięki.",
  "tokens": { "en": [{ "text": "I'm", "start": 0, "end": 2 }], "pl": [] }
}
```

- **Response 201** phrase object
- **Errors:** `409 unique_violation` (position duplicate), `400 validation_error` (length 1..2000)

#### PATCH `/api/phrases/:phraseId`

- **Desc:** Update text, tokens, or position of a phrase.
- **Request**

```json
{ "position": 30, "en_text": "...", "pl_text": "...", "tokens": {...} }
```

- **Response 200** phrase object
- **Errors:** `409 unique_violation`, `400 validation_error`

#### DELETE `/api/phrases/:phraseId`

- **Desc:** Delete phrase; cascades its audio segments.
- **Response 204**

#### POST `/api/notebooks/:notebookId/phrases:reorder`

- **Desc:** Bulk reorder positions. Accepts sparse updates; server validates uniqueness.
- **Request**

```json
{
  "moves": [
    { "phrase_id": "uuid1", "position": 10 },
    { "phrase_id": "uuid2", "position": 20 }
  ]
}
```

- **Response 200**

```json
{ "updated": 2 }
```

- **Errors:** `400 validation_error` (duplicate positions or non-members)

---

### 2.4 Import

#### POST `/api/notebooks:import`

- **Desc:** Create a notebook and import phrases from payload. Enforces PRD limits (≤200 phrases; ≤2000 chars per part).
- **Headers:** `Idempotency-Key` supported
- **Request**

```json
{
  "name": "Travel deck",
  "lines": ["Where is the station? ::: Gdzie jest stacja?", "One ticket, please. ::: Poproszę jeden bilet."],
  "normalize": true
}
```

- **Response 201**

```json
{
  "notebook": { "id": "uuid", "name": "Travel deck", "created_at": "...", "updated_at": "..." },
  "import": {
    "accepted": 2,
    "rejected": 0,
    "logs": []
  }
}
```

- **Errors:** `400 validation_error` (format), `413 limit_exceeded` (phrases>200)
- **Notes:** For rejected lines, rows are persisted to `import_logs` with `line_no`, `raw_text`, `reason`.

#### GET `/api/notebooks/:notebookId/import-logs`

- **Desc:** List import rejections for a notebook.
- **Query:** `limit`, `cursor`, `sort=created_at`, `order=desc|asc`
- **Response 200**

```json
{
  "items": [{ "id": "uuid", "line_no": 4, "raw_text": "...", "reason": "empty EN part", "created_at": "..." }],
  "next_cursor": null
}
```

---

### 2.5 User Voices (TTS selection)

#### GET `/api/user-voices`

- **Desc:** List configured slots for the user.
- **Response 200**

```json
{
  "slots": [
    { "id": "uuid", "slot": "EN1", "language": "en", "voice_id": "en-GB-Standard-B", "created_at": "..." },
    { "id": "uuid", "slot": "EN2", "language": "en", "voice_id": "en-US-Neural2-D", "created_at": "..." },
    { "id": "uuid", "slot": "EN3", "language": "en", "voice_id": "en-IE-Standard-A", "created_at": "..." },
    { "id": "uuid", "slot": "PL", "language": "pl", "voice_id": "pl-PL-Standard-A", "created_at": "..." }
  ]
}
```

#### PUT `/api/user-voices/:slot`

- **Desc:** Upsert one slot (`EN1|EN2|EN3|PL`). Validates language per slot and no duplicates per language in the four-slot set.
- **Request**

```json
{ "language": "en", "voice_id": "en-US-Neural2-D" }
```

- **Response 200**

```json
{ "id": "uuid", "slot": "EN2", "language": "en", "voice_id": "en-US-Neural2-D", "created_at": "..." }
```

- **Errors:** `400 validation_error` (slot-language mismatch), `409 conflict` (duplicate voice in same language set)

---

### 2.6 TTS Credentials

#### GET `/api/tts-credentials`

- **Desc:** Return configuration state only (never key material).
- **Response 200**

```json
{
  "is_configured": true,
  "last_validated_at": "2025-10-13T08:00:00Z",
  "key_fingerprint": "SHA256:abcd...ef"
}
```

#### POST `/api/tts-credentials:test`

- **Desc:** Validate a provided Google TTS key by making a server-side dry-run (no audio persisted).
- **Request**

```json
{ "google_api_key": "AIza..." }
```

- **Response 200**

```json
{ "ok": true, "voice_sampled": "en-US-Neural2-D" }
```

- **Errors:** `400 invalid_key`, `402 quota_exceeded`, `504 tts_timeout`

#### PUT `/api/tts-credentials`

- **Desc:** Save (or replace) credentials **after** a successful test. Server encrypts and stores as `encrypted_key`.
- **Request**

```json
{ "google_api_key": "AIza..." }
```

- **Response 200**

```json
{ "is_configured": true, "last_validated_at": "...", "key_fingerprint": "SHA256:..." }
```

#### DELETE `/api/tts-credentials`

- **Desc:** Remove credentials.
- **Response 204**

---

### 2.7 Jobs (Generate / Rebuild)

> A **Generate audio** acts as a full rebuild: creates a `jobs` row, a `builds` row, then enqueues work to render `audio_segments` for every `phrase × slot` present in `user_voices`. On success: flip `is_active` atoms, set `current_build_id` in notebook, and GC old MP3 files from storage. Failed segments are persisted with status `failed`.

#### POST `/api/notebooks/:notebookId/jobs:generate-rebuild`

- **Desc:** Start a full generate & rebuild for a notebook.
- **Headers:** `Idempotency-Key` supported
- **Request**

```json
{ "timeout_sec": 1800 }
```

**Note:** `timeout_sec` is optional and can be null (server will use default timeout).

- **Response 202**

```json
{
  "job": {
    "id": "uuid",
    "type": "GENERATE_REBUILD",
    "state": "queued",
    "notebook_id": "uuid",
    "started_at": null,
    "ended_at": null,
    "timeout_sec": 1800,
    "created_at": "..."
  }
}
```

- **Errors:** `400 validation_error` (no TTS config or voices missing), `409 job_in_progress`

#### GET `/api/notebooks/:notebookId/jobs`

- **Desc:** List jobs for a notebook.
- **Query:** `limit`, `cursor`, `state=queued|running|succeeded|failed|canceled|timeout`
- **Response 200**

```json
{
  "items": [
    {
      "id": "uuid",
      "type": "GENERATE_REBUILD",
      "state": "running",
      "started_at": "...",
      "ended_at": null,
      "timeout_sec": 1800,
      "error": null,
      "created_at": "..."
    }
  ],
  "next_cursor": null
}
```

#### GET `/api/jobs/:jobId`

- **Desc:** Job detail.
- **Response 200**

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "notebook_id": "uuid",
  "type": "GENERATE_REBUILD",
  "state": "succeeded",
  "started_at": "...",
  "ended_at": "...",
  "timeout_sec": 1800,
  "error": null,
  "created_at": "..."
}
```

#### POST `/api/jobs/:jobId:cancel`

- **Desc:** Request cancellation of a queued/running job.
- **Response 202**

```json
{ "id": "uuid", "state": "canceled" }
```

- **Errors:** `409 cannot_cancel` (already terminal)

---

### 2.8 Builds

#### GET `/api/notebooks/:notebookId/builds`

- **Desc:** List builds (latest first).
- **Query:** `limit`, `cursor`
- **Response 200**

```json
{
  "items": [{ "id": "uuid", "job_id": "uuid", "notebook_id": "uuid", "created_at": "..." }],
  "next_cursor": null
}
```

#### GET `/api/builds/:buildId`

- **Desc:** Build detail.
- **Response 200**

```json
{ "id": "uuid", "job_id": "uuid", "notebook_id": "uuid", "created_at": "..." }
```

---

### 2.9 Audio Segments

#### GET `/api/notebooks/:notebookId/audio-segments`

- **Desc:** List **active** audio segments for the current build.
- **Query:** `phrase_id=uuid` (optional), `voice_slot=EN1|EN2|EN3|PL` (optional), `status=complete|failed|missing` (optional), `limit`, `cursor`
- **Response 200**

```json
{
  "items": [
    {
      "id": "uuid",
      "phrase_id": "uuid",
      "voice_slot": "EN1",
      "build_id": "uuid",
      "path": "audio/{user_id}/{notebook_id}/{phrase_id}/EN1.mp3",
      "duration_ms": 1730,
      "size_bytes": 112345,
      "sample_rate_hz": 22050,
      "bitrate_kbps": 64,
      "status": "complete",
      "error_code": null,
      "word_timings": [{ "word": "How", "start_ms": 0, "end_ms": 200 }],
      "is_active": true,
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "next_cursor": null
}
```

**Note:** The `error_details` field exists in the database but is internal and not exposed through the API.

#### GET `/api/audio-segments/:audioSegmentId`

- **Desc:** Audio segment detail.
- **Response 200** segment object

> **Storage access:** For client playback, the app typically calls the **Playback Manifest** endpoint (below) to receive **short-lived signed URLs** for `path` objects in Supabase Storage. Direct `path` values are informational.

---

### 2.10 Notebook Audio Statuses

#### GET `/api/notebooks/:notebookId/audio-status`

- **Desc:** Aggregate counts for active build (via MV, or live query fallback).
- **Response 200**

```json
{
  "notebook_id": "uuid",
  "build_id": "uuid",
  "complete_count": 380,
  "failed_count": 2,
  "missing_count": 18,
  "updated_at": "2025-10-13T09:59:00Z"
}
```

---

### 2.11 Playback Manifest (virtual)

#### GET `/api/notebooks/:notebookId/playback-manifest`

- **Desc:** Returns ordered phrases and, for each, the sequence EN1→EN2→EN3→PL with **signed URLs** for active segments. Missing/failed segments are **omitted** from the response; the sequence preserves order per PRD.
- **Query:** `phrase_ids=uuid,uuid,...` (optional subset), `speed=0.75|0.9|1|1.25` (affects player hints only), `highlight=on|off` (hint)
- **Response 200**

```json
{
  "notebook_id":"uuid",
  "build_id":"uuid",
  "sequence": [
    {
      "phrase": {
        "id":"uuid",
        "position":10,
        "en_text":"How are you?",
        "pl_text":"Jak się masz?",
        "tokens": { "en":[...], "pl":[...] }
      },
      "segments": [
        { "slot":"EN1", "status":"complete", "url":"https://signed...", "duration_ms":1730, "word_timings":[...] },
        { "slot":"EN2", "status":"complete", "url":"https://signed..." },
        { "slot":"PL",  "status":"complete", "url":"https://signed..." }
      ]
    }
  ],
  "expires_at":"2025-10-13T10:05:00Z"
}
```

**Note:** Only segments with `status: "complete"` are included. Failed or missing segments are omitted entirely.

---

### 2.12 Health & Metadata

#### GET `/api/health`

- **Desc:** Liveness/readiness and DB connectivity.
- **Response 200**

```json
{ "status": "ok", "db": "ok", "time": "2025-10-13T10:00:00Z" }
```

---

## 3. Authentication & Authorization

- **Auth mechanism:** Supabase JWT in `Authorization: Bearer <token>` issued by Supabase Auth.
- **RLS enforcement:** All tables have RLS enabled per the DB plan. For **server-only operations** (TTS tests, job orchestration, storage signing), the API:
  1. **Validates ownership** by selecting through RLS-aware queries (or joining via notebook→user).
  2. Performs privileged work (e.g., storage URL signing, TTS calls) on behalf of the user, never returning secret keys.

- **Scopes/roles:** MVP uses a single end-user role. Admin endpoints are out of scope.
- **Storage:** Supabase Storage buckets with object paths under `audio/{user_id}/{notebook_id}/{phrase_id}/{voice_slot}.mp3`. Signed URLs have short TTL (e.g., 5 minutes) and are only returned via `playback-manifest`.
- **CORS:** Restricted to the app origin.
- **Rate limiting (recommendation):** IP+user token bucket, e.g., 60 req/min, stricter for mutation routes (e.g., 10 req/min), and separate burst control for `/jobs:generate-rebuild` and `/tts-credentials:test` (e.g., 3/min).

---

## 4. Validation & Business Logic

### 4.1 Cross-cutting validation

- **UUIDs:** Path params must be UUIDs.
- **Timestamps:** Use `timestamptz` ISO-8601 in responses.
- **Idempotency:** When `Idempotency-Key` is given, repeated POST returns the original response.

### 4.2 Resource-specific validation

**Notebooks**

- `name` length 1..100; unique per user (case-insensitive via `citext`).
- Create/update set `updated_at = now()`.

**Phrases**

- `en_text` and `pl_text` length 1..2000.
- `position` integer; uniqueness per notebook enforced by DB unique `(notebook_id, position)`.
- `tokens` JSON schema (optional) to align with click-to-seek (arrays per language with `text`, `start`, `end` where start/end are character indices, not time-based); the API stores as-is.

**User Voices**

- `slot ∈ {EN1,EN2,EN3,PL}`.
- Check `(slot IN EN* ⇒ language='en')` and `(slot='PL' ⇒ language='pl')`.
- Enforce unique `(user_id, slot)` and prevent **language duplicates** within EN group (app-level constraint per PRD).

**TTS Credentials**

- Never persist raw key in clear text; encrypt app-side → `encrypted_key`.
- On `:test`, perform a minimal TTS request and map failures to `invalid_key|quota|network|timeout`.

**Jobs**

- `type = GENERATE_REBUILD`.
- `timeout_sec` null or 1..86400.
- One **active** job per notebook at a time (`queued|running`); reject with `409 job_in_progress`.
- Lifecycle transitions: `queued → running → (succeeded|failed|canceled|timeout)`.

**Builds & Audio Segments**

- On success:
  - Mark previous active segments `is_active=false` for the notebook.
  - Mark new build segments `is_active=true` and set `notebooks.current_build_id`.
  - Enforce partial unique `(phrase_id, voice_slot) WHERE is_active=true`.
  - GC old MP3 files (storage) outside the DB transaction.

- Segment constraints:
  - `duration_ms` null or 1..10_000_000.
  - `size_bytes` null or ≥0.
  - `sample_rate_hz = 22050` (default), `bitrate_kbps = 64` (default).
  - `status ∈ {complete, failed, missing}`; `error_code` optional (`quota|invalid_key|tts_timeout|network|text_too_long|...`).

**Import**

- Input lines must match exactly one `:::` separator with non-empty EN/PL.
- Normalize if `normalize=true`: typographic quotes, zero-width removal, double spaces, basic character fixes.
- Limits: ≤200 phrases per import, ≤2000 chars per side; total notebooks per user ≤500 (enforced app-side).
- Persist rejects in `import_logs`.

**Playback Manifest**

- Order segments strictly EN1→EN2→EN3→PL per phrase, omitting missing/failed entirely from the response.
- Include word timings if present (time-based in milliseconds).
- Generate short-lived signed URLs.
- Only segments with `status: "complete"` are included in the manifest.

### 4.3 Business flows → API

**Generate/Rebuild flow**

1. Client calls `POST /notebooks/:id/jobs:generate-rebuild`.
2. Worker consumes job:
   - Create `build` row linked to job.
   - For each phrase × user-voices slot, call Google TTS; stream to Storage; insert `audio_segments` with `status`.
   - After all:
     - If any catastrophic error → mark job `failed`, leave `is_active` unchanged.
     - Else mark new segments `is_active=true`, old `false`; update `current_build_id`.

3. Client polls `GET /jobs/:jobId` or subscribes via Supabase Realtime (optional).

**Playback**

- Client requests `GET /notebooks/:id/playback-manifest` (optionally for a subset of `phrase_ids`).
- API returns ordered phrases with signed URLs and timings; player uses own 800 ms pauses and auto-advance logic.

**Import**

- Client posts lines; API validates, creates notebook, upserts phrases with spaced positions (e.g., 10,20,...) and writes `import_logs`.

### 4.4 Index usage (performance notes)

- `notebooks_idx_user_updated` → `GET /notebooks` default sort by `updated_at DESC`.
- `phrases_idx_notebook_position` → `GET /notebooks/:id/phrases` default sort by `position`.
- `audio_segments_uq_active_slot` & `audio_segments_idx_phrase_slot_active` → efficient manifest building.
- `jobs_idx_notebook_started` & `jobs_idx_state` → job listings and dashboards.
- `builds_idx_notebook_created` → build history.
- Partial index on `audio_segments(status WHERE status <> 'complete')` → status dashboards.

---

## 5. Security & Safety

- **Secrets handling:** TTS key stored as `encrypted_key` (application encryption), never logged, never sent to client. Validation via server-only endpoint.
- **RLS-first:** All selects/updates pass through RLS; additional ownership assertions in service layer for state-changing procedures (jobs, signing).
- **Least privilege storage:** Use service key to sign URLs; URLs expire quickly.
- **Abuse controls:** Rate limiting; anti-DoS on TTS test/generate; enforce per-user notebook and phrase limits.
- **Input hardening:** Strict JSON schemas; trimming; separator validation; maximum body size (e.g., 256 KB) for import.

---

## 6. Responses & Error Catalog (selected)

| HTTP | code               | message (example)                  | When                   |
| ---- | ------------------ | ---------------------------------- | ---------------------- |
| 400  | `validation_error` | Field `name` must be 1..100 chars. | Bad payload            |
| 400  | `invalid_key`      | Google TTS key is invalid.         | TTS test failure       |
| 402  | `quota_exceeded`   | TTS provider quota exhausted.      | TTS/Generation         |
| 404  | `not_found`        | Notebook not found.                | Missing or RLS-blocked |
| 409  | `unique_violation` | Notebook name already exists.      | `citext` uniqueness    |
| 409  | `job_in_progress`  | A generate job is already running. | Generate               |
| 409  | `conflict`         | Duplicate EN voice within slots.   | User voices            |
| 413  | `limit_exceeded`   | Import exceeds 200 phrases.        | Import                 |
| 422  | `cannot_cancel`    | Job already in terminal state.     | Cancel                 |
| 500  | `internal`         | Unexpected error.                  | Server fault           |
| 504  | `tts_timeout`      | TTS provider timed out.            | TTS/Generation         |

---

## 7. Example OpenAPI Fragments (abbreviated)

> (Optional implementation aid)

```yaml
components:
  securitySchemes:
    supabaseAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
security:
  - supabaseAuth: []
```

---

## 8. Assumptions

- Supabase Storage bucket `audio` exists; path scheme exactly as in DB plan.
- Worker for TTS generation runs in the same project with DB and Storage access.
- Materialized view `notebook_audio_statuses` is refreshed at job completion; endpoint falls back to live aggregate when MV absent.
- Cursor tokens are opaque, signed, and encode the last sort key(s).

---

## 9. Non-goals (per MVP)

- No public sharing, webhooks, or admin APIs.
- No partial regeneration (per-phrase) in MVP (future enhancement: `:regenerate?phrase_id=`).
- No hotkeys/offline support at the API layer.

---

## 10. Versioning & Stability

- **Base path:** `/api` (v1 implicitly).
- **Breaking changes:** Introduce `/api/v2` when needed.
- **Headers:** Return `ETag` on GETs for caching; support `If-None-Match` for notebooks/phrases lists.

---

## 11. Telemetry & Observability (recommended)

- Structured logs (request id, user id, route, latency, db timings).
- Job metrics: durations, per-segment success/failed/missing counts.
- Alerts on job failure rates, TTS error spikes, and RLS violation attempts.

---

**End of plan.**
