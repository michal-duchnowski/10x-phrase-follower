import type { Tables, TablesInsert, TablesUpdate, Enums, Json } from "./db/database.types";

/**
 * Shared DTO and Command Model types for the API, derived from Supabase DB models.
 *
 * Conventions:
 * - DTO types reflect API response shapes and are tied to DB entities via `Pick<Tables<...>>`.
 * - Command models reflect API request bodies; they intentionally include only client-provided fields.
 * - Where the API uses structured JSON (e.g., `tokens`, `word_timings`), we expose strong TS types,
 *   even though the DB persists them as `Json`.
 */

// ------------------------------------
// Enums (re-exported for convenience)
// ------------------------------------
export type VoiceSlot = Enums<"voice_slot_enum">;
export type AudioStatus = Enums<"audio_status_enum">;
export type JobState = Enums<"job_state_enum">;
export type JobType = Enums<"job_type_enum">;

// ------------------------------------
// Common helpers
// ------------------------------------
export type UUID = string;

export interface Paginated<T> {
  items: T[];
  next_cursor: string | null;
}

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "validation_error"
  | "invalid_key"
  | "quota_exceeded"
  | "not_found"
  | "unique_violation"
  | "job_in_progress"
  | "conflict"
  | "limit_exceeded"
  | "cannot_cancel"
  | "internal"
  | "tts_timeout"
  | "invalid_credentials"
  | "too_many_requests"
  | "invalid_body";

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Json;
  };
}

// ------------------------------------
// Users
// ------------------------------------
export type UserDTO = Pick<Tables<"users">, "id" | "created_at">;

// ------------------------------------
// Notebooks
// ------------------------------------
export type NotebookDTO = Pick<
  Tables<"notebooks">,
  "id" | "name" | "current_build_id" | "last_generate_job_id" | "created_at" | "updated_at"
>;

export type CreateNotebookCommand = Pick<TablesInsert<"notebooks">, "name">;

export type UpdateNotebookCommand = Pick<TablesUpdate<"notebooks">, "name">;

export type NotebookListResponse = Paginated<NotebookDTO>;

// ------------------------------------
// Phrases
// ------------------------------------
/**
 * Tokenization structure stored in `phrases.tokens` (DB Json), but exposed strongly via DTOs.
 * start/end are character indices in the text, not time-based.
 * Example element: { text: "I'm", start: 0, end: 2 }
 */
export interface PhraseToken {
  text: string;
  start: number; // Character index start position
  end: number; // Character index end position
}

export interface PhraseTokens {
  en: PhraseToken[];
  pl: PhraseToken[];
}

/**
 * Difficulty level for a phrase: easy, medium, or hard.
 * NULL in database represents "unset" (not assessed yet).
 */
export type PhraseDifficulty = "easy" | "medium" | "hard";

/**
 * Difficulty level including "unset" state for UI purposes.
 * Maps to: PhraseDifficulty | null in database.
 */
export type PhraseDifficultyOrUnset = PhraseDifficulty | "unset";

export type PhraseDTO = Pick<
  Tables<"phrases">,
  "id" | "position" | "en_text" | "pl_text" | "created_at" | "updated_at"
> & {
  // Strongly typed version of DB Json
  tokens: PhraseTokens | null;
  // Difficulty: null means "unset"
  difficulty: PhraseDifficulty | null;
  // For virtual notebooks (cross-notebook views), include source notebook info
  notebook_id?: UUID;
  notebook_name?: string;
};

export type CreatePhraseCommand = Pick<TablesInsert<"phrases">, "position" | "en_text" | "pl_text"> & {
  tokens?: PhraseTokens | null;
  difficulty?: PhraseDifficulty | null;
};

export type UpdatePhraseCommand = Partial<Pick<TablesUpdate<"phrases">, "position" | "en_text" | "pl_text">> & {
  tokens?: PhraseTokens | null;
  // null clears difficulty (sets to unset), undefined means "no change"
  difficulty?: PhraseDifficulty | null;
};

export type PhraseListResponse = Paginated<PhraseDTO>;

export interface ReorderPhrasesCommand {
  moves: {
    phrase_id: UUID;
    position: number;
  }[];
}

export interface ReorderPhrasesResultDTO {
  updated: number;
}

export interface BulkUpdatePhrasesCommand {
  phrase_ids: UUID[];
  difficulty: PhraseDifficulty | null;
}

export interface BulkUpdatePhrasesResultDTO {
  updated: number;
}

// ------------------------------------
// Import
// ------------------------------------
export interface ImportNotebookCommand {
  name: string;
  lines: string[];
  normalize: boolean;
}

export type ImportLogDTO = Pick<Tables<"import_logs">, "id" | "line_no" | "raw_text" | "reason" | "created_at">;

export interface ImportNotebookResultDTO {
  notebook: NotebookDTO;
  import: {
    accepted: number;
    rejected: number;
    logs: ImportLogDTO[];
  };
}

export type ImportLogsListResponse = Paginated<ImportLogDTO>;

// ------------------------------------
// Snapshots
// ------------------------------------
export interface CreateSnapshotCommand {
  source_notebook_id: string; // UUID for regular notebook, or "difficulty-easy|medium|hard" for smart lists
  phrase_ids: UUID[];
}

export interface CreateSnapshotResultDTO {
  id: UUID;
  name: string;
  created_at: string;
  updated_at: string;
}

// ------------------------------------
// User Voices (TTS selection)
// ------------------------------------
export type UserVoiceDTO = Pick<Tables<"user_voices">, "id" | "slot" | "language" | "voice_id" | "created_at">;

export interface UpsertUserVoiceBySlotCommand {
  language: string;
  voice_id: string;
}

export interface UserVoicesListResponse {
  slots: UserVoiceDTO[];
}

// ------------------------------------
// TTS Credentials
// ------------------------------------
export type TtsCredentialsStateDTO = Pick<
  Tables<"tts_credentials">,
  "is_configured" | "last_validated_at" | "key_fingerprint"
>;

export interface TestTtsCredentialsCommand {
  google_api_key: string;
}

export interface TestTtsCredentialsResultDTO {
  ok: boolean;
  voice_sampled: string;
}

export interface SaveTtsCredentialsCommand {
  google_api_key: string;
}

// ------------------------------------
// Jobs (Generate / Rebuild)
// ------------------------------------
export type JobDTO = Pick<
  Tables<"jobs">,
  | "id"
  | "user_id"
  | "notebook_id"
  | "type"
  | "state"
  | "started_at"
  | "ended_at"
  | "timeout_sec"
  | "error"
  | "created_at"
>;

export interface GenerateRebuildJobCommand {
  timeout_sec?: number | null;
}

export interface GenerateRebuildAcceptedDTO {
  job: Pick<
    Tables<"jobs">,
    "id" | "type" | "state" | "notebook_id" | "started_at" | "ended_at" | "timeout_sec" | "created_at"
  >;
}

export type JobListResponse = Paginated<JobDTO>;

export type CancelJobResponseDTO = Pick<Tables<"jobs">, "id" | "state">;

// ------------------------------------
// Builds
// ------------------------------------
export type BuildDTO = Pick<Tables<"builds">, "id" | "job_id" | "notebook_id" | "created_at">;

export type BuildListResponse = Paginated<BuildDTO>;

// ------------------------------------
// Audio Segments
// ------------------------------------
/**
 * Word timing structure persisted as Json in DB but exposed strongly in DTOs.
 * Time-based positions in milliseconds for audio playback synchronization.
 */
export interface WordTiming {
  word: string;
  start_ms: number; // Start time in milliseconds
  end_ms: number; // End time in milliseconds
}

export type AudioSegmentDTO = Pick<
  Tables<"audio_segments">,
  | "id"
  | "phrase_id"
  | "voice_slot"
  | "build_id"
  | "path"
  | "duration_ms"
  | "size_bytes"
  | "sample_rate_hz"
  | "bitrate_kbps"
  | "status"
  | "error_code"
  | "is_active"
  | "created_at"
  | "updated_at"
> & {
  // Strongly typed version of DB Json
  word_timings: WordTiming[] | null;
};

export type AudioSegmentListResponse = Paginated<AudioSegmentDTO>;

// ------------------------------------
// Notebook Audio Status (aggregated / MV)
// ------------------------------------
export interface NotebookAudioStatusDTO {
  notebook_id: UUID;
  build_id: UUID;
  complete_count: number;
  failed_count: number;
  missing_count: number;
  updated_at: string;
}

// ------------------------------------
// Playback Manifest (virtual)
// ------------------------------------
/**
 * Playback manifest segment - only includes complete segments with URLs.
 * Failed/missing segments are omitted from the manifest.
 */
export interface PlaybackManifestSegment {
  slot: VoiceSlot;
  status: Extract<AudioStatus, "complete">;
  url: string;
  duration_ms?: number | null;
  word_timings?: WordTiming[] | null;
}

export interface PlaybackManifestItem {
  phrase: Pick<PhraseDTO, "id" | "position" | "en_text" | "pl_text" | "tokens" | "difficulty">;
  segments: PlaybackManifestSegment[];
}

export interface PlaybackManifestDTO {
  notebook_id: UUID;
  build_id: UUID | null;
  sequence: PlaybackManifestItem[];
  expires_at: string;
}

// ------------------------------------
// Auth
// ------------------------------------
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  user: {
    id: string;
    email: string;
  };
}

// ------------------------------------
// Health
// ------------------------------------
export interface HealthStatusDTO {
  status: "ok";
  db: "ok" | "degraded" | "down";
  time: string;
}

// ------------------------------------
// Player-specific types (ViewModel)
// ------------------------------------
/**
 * Frontend ViewModel types for the player interface.
 * These are derived from DTOs but optimized for UI state management.
 */

export interface PhraseVM {
  id: UUID;
  position: number;
  en_text: string;
  pl_text: string;
  difficulty: PhraseDifficulty | null;
  tokens: {
    en: Token[];
    pl: Token[];
  };
}

export interface Token {
  text: string;
  charStart: number;
  charEnd: number;
  timing?: {
    startMs: number;
    endMs: number;
  };
}

export interface Segment {
  slot: VoiceSlot;
  status: "complete" | "failed" | "missing";
  url: string;
  durationMs?: number | null;
  timings?: Token["timing"][];
}

export type PlaybackSpeed = 0.75 | 0.9 | 1 | 1.25;

export interface PlayerState {
  playing: boolean;
  currentPhraseIndex: number;
  currentSlot: VoiceSlot | null;
  speed: PlaybackSpeed;
  highlight: boolean;
  clockMs: number;
}

export interface PlaybackSequenceItem {
  phrase: PhraseVM;
  segments: Segment[];
}

export interface PlaybackManifestVM {
  notebookId: UUID;
  buildId: UUID | null;
  sequence: PlaybackSequenceItem[];
  expiresAt: string;
}

export type HighlightMode = "on" | "off";

export interface TokenTimingsHint {
  word: string;
  startMs: number;
  endMs: number;
}

// ------------------------------------
// Learn Mode
// ------------------------------------

export type LearnDirection = "en_to_pl" | "pl_to_en";

export interface LearnPhraseAudioAvailability {
  has_en_audio: boolean;
  has_pl_audio: boolean;
}

export interface LearnPhraseDTO {
  id: UUID;
  position: number;
  en_text: string;
  pl_text: string;
  tokens: PhraseTokens | null;
  difficulty: PhraseDifficulty | null;
  audio: LearnPhraseAudioAvailability;
}

export interface LearnManifestDTO {
  notebook_id: UUID;
  phrase_count: number;
  phrases: LearnPhraseDTO[];
}

export interface CheckAnswerCommand {
  phrase_id: UUID;
  user_answer: string;
  direction: LearnDirection;
  use_contains_mode?: boolean; // If true, user answer is correct if it matches any word in correct answer
}

export interface CheckAnswerResultDTO {
  is_correct: boolean;
  normalized_user: string;
  normalized_correct: string;
}
