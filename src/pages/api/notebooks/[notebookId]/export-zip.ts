/* eslint-disable no-console */
import type { APIContext } from "astro";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../db/database.types";
import { ApiErrors, withErrorHandling } from "../../../../lib/errors";
import {
  getSupabaseClient,
  ensureUserExists,
  isVirtualNotebook,
  getDifficultyFromVirtualNotebook,
} from "../../../../lib/utils";
import { canExport, markExport } from "../../../../lib/export-zip-rate-limit";
import { buildPhraseFilename, sanitizeNotebookName } from "../../../../lib/export-zip.utils";
import archiver from "archiver";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export const prerender = false;

// Get path to silence file
// File is copied to dist/assets during build (see package.json copy-silence-asset script)
// From dist/server/pages/api/notebooks/[notebookId]/ we need to go up to dist/ then to assets
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// dist/server/pages/api/notebooks/[notebookId]/ -> dist/assets
const SILENCE_FILE_PATH = join(__dirname, "../../../../../assets/silence-800ms.mp3");

type Supabase = SupabaseClient<Database>;

// Required voice slots for export
const REQUIRED_SLOTS = ["EN1", "EN2", "EN3", "PL"] as const;

// ZIP size limit: 30 MB
const ZIP_SIZE_LIMIT_BYTES = 30 * 1024 * 1024;

interface PhraseRow {
  id: string;
  position: number;
  en_text: string;
  pl_text: string;
}

interface PhraseRowWithNotebookId extends PhraseRow {
  notebook_id: string;
  created_at?: string;
}

interface AudioSegmentRow {
  phrase_id: string;
  voice_slot: string;
  path: string;
  size_bytes: number | null;
  status: string;
  build_id?: string;
}

interface ExportablePhrase {
  phrase: PhraseRow;
  segments: Map<string, AudioSegmentRow>; // key = voice_slot
}

/**
 * Helper function to get user ID from context
 */
function getUserId(context: APIContext): string {
  const userId = context.locals.userId;
  if (!userId) {
    throw ApiErrors.unauthorized("Authentication required");
  }
  return userId;
}

/**
 * Validates notebook ID format (UUID)
 */
function validateNotebookId(notebookId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notebookId)) {
    throw ApiErrors.validationError("Invalid notebook ID format");
  }
}

function getVirtualNotebookName(notebookId: string): string {
  const difficulty = getDifficultyFromVirtualNotebook(notebookId);
  if (difficulty === "easy") return "All Easy";
  if (difficulty === "medium") return "All Medium";
  if (difficulty === "hard") return "All Hard";
  return "Smart List";
}

/**
 * Gets storage client (service role if available, otherwise request client)
 */
function getStorageClient(context: APIContext, supabase: Supabase): Supabase {
  const supabaseUrl = process.env.SUPABASE_URL || import.meta.env.SUPABASE_URL || import.meta.env.PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseServiceKey) {
    return createClient<Database>(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return supabase;
}

/**
 * Fetches notebook and validates ownership
 */
async function fetchNotebook(supabase: Supabase, notebookId: string, userId: string) {
  const { data: notebook, error } = await supabase
    .from("notebooks")
    .select("id, name, user_id, current_build_id")
    .eq("id", notebookId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw ApiErrors.notFound("Notebook not found");
    }
    console.error("[export-zip] Database error fetching notebook:", error);
    throw ApiErrors.internal("Failed to fetch notebook");
  }

  if (!notebook) {
    throw ApiErrors.notFound("Notebook not found");
  }

  if (notebook.user_id !== userId) {
    throw ApiErrors.notFound("Notebook not found"); // Don't reveal existence
  }

  if (!notebook.current_build_id) {
    throw ApiErrors.validationError("Brak gotowego buildu audio dla tego notatnika. Wygeneruj audio przed eksportem.");
  }

  return notebook;
}

/**
 * Fetches phrases for the notebook, ordered by position (optionally filtered by difficulty)
 */
async function fetchPhrasesForNotebookWithDifficultyFilter(
  supabase: Supabase,
  notebookId: string,
  difficultyParam: string | null
): Promise<PhraseRow[]> {
  let query = supabase
    .from("phrases")
    .select("id, position, en_text, pl_text")
    .eq("notebook_id", notebookId)
    .order("position", { ascending: true });

  if (difficultyParam) {
    if (difficultyParam === "unset") {
      query = query.is("difficulty", null);
    } else if (difficultyParam === "easy" || difficultyParam === "medium" || difficultyParam === "hard") {
      query = query.eq("difficulty", difficultyParam);
    } else {
      throw ApiErrors.validationError("Invalid difficulty filter. Must be 'easy', 'medium', 'hard', or 'unset'");
    }
  }

  const { data: phrases, error } = await query;

  if (error) {
    console.error("[export-zip] Database error fetching phrases:", error);
    throw ApiErrors.internal("Failed to fetch phrases");
  }

  return (phrases || []) as PhraseRow[];
}

const MAX_VIRTUAL_EXPORT_PHRASES = 1000;

async function fetchVirtualNotebookIdsForExport(
  supabase: Supabase,
  userId: string,
  onlyPinned: boolean,
  selectedNotebookIds: string[]
): Promise<string[]> {
  if (selectedNotebookIds.length > 0) {
    let candidateNotebookIds = selectedNotebookIds;

    if (onlyPinned) {
      const { data: pinnedNotebooks, error: pinnedError } = await supabase
        .from("pinned_notebooks")
        .select("notebook_id")
        .eq("user_id", userId);

      if (pinnedError) {
        console.error("[export-zip] Database error fetching pinned notebooks:", pinnedError);
        throw ApiErrors.internal("Failed to fetch pinned notebooks");
      }

      if (!pinnedNotebooks || pinnedNotebooks.length === 0) {
        return [];
      }

      const pinnedIds = new Set(pinnedNotebooks.map((pin) => pin.notebook_id));
      candidateNotebookIds = selectedNotebookIds.filter((id) => pinnedIds.has(id));
      if (candidateNotebookIds.length === 0) {
        return [];
      }
    }

    const { data: userNotebooks, error: notebooksError } = await supabase
      .from("notebooks")
      .select("id")
      .eq("user_id", userId)
      .in("id", candidateNotebookIds);

    if (notebooksError) {
      console.error("[export-zip] Database error fetching selected notebooks:", notebooksError);
      throw ApiErrors.internal("Failed to fetch selected notebooks");
    }

    if (!userNotebooks || userNotebooks.length === 0) {
      return [];
    }

    return userNotebooks.map((nb) => nb.id);
  }

  if (onlyPinned) {
    const { data: pinnedNotebooks, error: pinnedError } = await supabase
      .from("pinned_notebooks")
      .select("notebook_id")
      .eq("user_id", userId);

    if (pinnedError) {
      console.error("[export-zip] Database error fetching pinned notebooks:", pinnedError);
      throw ApiErrors.internal("Failed to fetch pinned notebooks");
    }

    if (!pinnedNotebooks || pinnedNotebooks.length === 0) {
      return [];
    }

    return pinnedNotebooks.map((pin) => pin.notebook_id);
  }

  const { data: userNotebooks, error: notebooksError } = await supabase
    .from("notebooks")
    .select("id")
    .eq("user_id", userId);

  if (notebooksError) {
    console.error("[export-zip] Database error fetching user notebooks:", notebooksError);
    throw ApiErrors.internal("Failed to fetch user notebooks");
  }

  return (userNotebooks || []).map((nb) => nb.id);
}

async function fetchPhrasesForVirtualNotebook(
  supabase: Supabase,
  userId: string,
  notebookId: string,
  onlyPinned: boolean,
  selectedNotebookIds: string[],
  sortParam: string | null,
  orderParam: string | null
): Promise<PhraseRowWithNotebookId[]> {
  const difficulty = getDifficultyFromVirtualNotebook(notebookId);
  if (!difficulty) {
    throw ApiErrors.validationError("Invalid smart list ID");
  }

  const notebookIds = await fetchVirtualNotebookIdsForExport(supabase, userId, onlyPinned, selectedNotebookIds);
  if (notebookIds.length === 0) {
    return [];
  }

  const sort = sortParam === "position" || sortParam === "created_at" ? sortParam : "created_at";
  const order = orderParam === "asc" || orderParam === "desc" ? orderParam : "desc";

  const { data: phrases, error } = await supabase
    .from("phrases")
    .select("id, position, en_text, pl_text, notebook_id, created_at")
    .in("notebook_id", notebookIds)
    .eq("difficulty", difficulty)
    .order(sort, { ascending: order === "asc" })
    .limit(MAX_VIRTUAL_EXPORT_PHRASES + 1);

  if (error) {
    console.error("[export-zip] Database error fetching virtual phrases:", error);
    throw ApiErrors.internal("Failed to fetch phrases");
  }

  if (phrases && phrases.length > MAX_VIRTUAL_EXPORT_PHRASES) {
    throw ApiErrors.limitExceeded(
      `Smart list export exceeds ${MAX_VIRTUAL_EXPORT_PHRASES} phrases. Narrow filters before exporting.`
    );
  }

  return (phrases || []) as unknown as PhraseRowWithNotebookId[];
}

/**
 * Fetches audio segments for the build
 */
async function fetchAudioSegments(
  supabase: Supabase,
  buildId: string,
  phraseIds: string[]
): Promise<AudioSegmentRow[]> {
  if (phraseIds.length === 0) {
    return [];
  }

  const { data: segments, error } = await supabase
    .from("audio_segments")
    .select("phrase_id, voice_slot, path, size_bytes, status")
    .eq("build_id", buildId)
    .eq("status", "complete")
    .in("phrase_id", phraseIds);

  if (error) {
    console.error("[export-zip] Database error fetching audio segments:", error);
    throw ApiErrors.internal("Failed to fetch audio segments");
  }

  return (segments || []) as AudioSegmentRow[];
}

async function fetchAudioSegmentsForBuilds(
  supabase: Supabase,
  buildIds: string[],
  phraseIds: string[]
): Promise<AudioSegmentRow[]> {
  if (buildIds.length === 0 || phraseIds.length === 0) {
    return [];
  }

  const { data: segments, error } = await supabase
    .from("audio_segments")
    .select("build_id, phrase_id, voice_slot, path, size_bytes, status")
    .in("build_id", buildIds)
    .eq("status", "complete")
    .in("phrase_id", phraseIds);

  if (error) {
    console.error("[export-zip] Database error fetching audio segments:", error);
    throw ApiErrors.internal("Failed to fetch audio segments");
  }

  return (segments || []) as AudioSegmentRow[];
}

function buildPhrasesMarkdown(phrases: PhraseRow[]): string {
  // Format identical to import: one phrase per line: EN ::: PL
  // Keep original text (do not normalize) to avoid unexpected diffs.
  const lines = phrases.map((p) => `${p.en_text} ::: ${p.pl_text}`);
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

/**
 * Filters phrases to only those with all required segments
 */
function selectExportablePhrases(phrases: PhraseRow[], segments: AudioSegmentRow[]): ExportablePhrase[] {
  // Group segments by phrase_id
  const segmentsByPhrase = new Map<string, Map<string, AudioSegmentRow>>();

  for (const segment of segments) {
    if (!segmentsByPhrase.has(segment.phrase_id)) {
      segmentsByPhrase.set(segment.phrase_id, new Map());
    }
    const phraseSegments = segmentsByPhrase.get(segment.phrase_id);
    if (phraseSegments) {
      phraseSegments.set(segment.voice_slot, segment);
    }
  }

  // Filter phrases that have all required slots
  const exportable: ExportablePhrase[] = [];

  for (const phrase of phrases) {
    const phraseSegments = segmentsByPhrase.get(phrase.id);
    if (!phraseSegments) {
      continue; // No segments for this phrase
    }

    // Check if all required slots are present
    const hasAllSlots = REQUIRED_SLOTS.every((slot) => phraseSegments.has(slot));

    if (hasAllSlots) {
      exportable.push({
        phrase,
        segments: phraseSegments,
      });
    }
  }

  return exportable;
}

/**
 * Estimates ZIP size based on audio segment sizes
 */
function estimateZipSize(exportablePhrases: ExportablePhrase[]): number {
  let totalAudioBytes = 0;

  for (const { segments } of exportablePhrases) {
    for (const slot of REQUIRED_SLOTS) {
      const segment = segments.get(slot);
      if (segment?.size_bytes) {
        totalAudioBytes += segment.size_bytes;
      }
    }
  }

  // Add overhead: 1% + 1 MB for ZIP structure
  const estimatedZipBytes = totalAudioBytes * 1.01 + 1_000_000;

  return estimatedZipBytes;
}

/**
 * Downloads an audio segment from Supabase Storage
 */
async function downloadSegment(storageClient: Supabase, path: string): Promise<Buffer> {
  const { data, error } = await storageClient.storage.from("audio").download(path);

  if (error || !data) {
    throw new Error(`Failed to download segment: ${path} - ${error?.message || "Unknown error"}`);
  }

  // Convert Blob to Buffer
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Loads the silence MP3 file (800ms)
 * Cached to avoid reading from disk for each phrase
 */
let cachedSilenceBuffer: Buffer | null = null;

function getSilenceMp3(): Buffer {
  if (cachedSilenceBuffer) {
    return cachedSilenceBuffer;
  }

  try {
    cachedSilenceBuffer = readFileSync(SILENCE_FILE_PATH);
    return cachedSilenceBuffer;
  } catch (error) {
    throw new Error(`Failed to load silence file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Creates a combined MP3 from segments with 800ms silence between them
 * Uses simple MP3 concatenation (MP3 format supports direct byte concatenation)
 */
async function createPhraseMp3(storageClient: Supabase, exportablePhrase: ExportablePhrase): Promise<Buffer> {
  // Download all segments in order
  const segmentBuffers: Buffer[] = [];

  for (const slot of REQUIRED_SLOTS) {
    const segment = exportablePhrase.segments.get(slot);
    if (!segment) {
      throw new Error(`Missing segment for slot ${slot} in phrase ${exportablePhrase.phrase.id}`);
    }

    const buffer = await downloadSegment(storageClient, segment.path);
    segmentBuffers.push(buffer);
  }

  // Load silence MP3 (cached)
  const silenceBuffer = getSilenceMp3();

  // Concatenate: segment0 + silence + segment1 + silence + segment2 + silence + segment3
  const result: Buffer[] = [];
  for (let i = 0; i < segmentBuffers.length; i++) {
    result.push(segmentBuffers[i]);
    if (i < segmentBuffers.length - 1) {
      result.push(silenceBuffer);
    }
  }

  return Buffer.concat(result);
}

/**
 * Main export handler
 */
async function handleExport(context: APIContext): Promise<Response> {
  const userId = getUserId(context);
  const notebookId = context.params.notebookId;

  if (!notebookId) {
    throw ApiErrors.validationError("Notebook ID is required");
  }

  const isVirtual = isVirtualNotebook(notebookId);
  if (!isVirtual) {
    validateNotebookId(notebookId);
  }

  // Check rate limit
  if (!canExport(userId, notebookId)) {
    throw ApiErrors.tooManyRequests("Eksport dla tego notatnika był niedawno wykonany. Spróbuj ponownie za 30 sekund.");
  }

  const supabase = getSupabaseClient(context);
  await ensureUserExists(supabase, userId);

  // Parse filters from query params
  const url = new URL(context.request.url);
  const difficultyParam = url.searchParams.get("difficulty");
  const pinnedParam = url.searchParams.get("pinned");
  const onlyPinned = pinnedParam === "1";
  const notebookIdsParam = url.searchParams.get("notebook_ids");
  const selectedNotebookIds = notebookIdsParam ? notebookIdsParam.split(",").filter((id) => id.length > 0) : [];
  const sortParam = url.searchParams.get("sort");
  const orderParam = url.searchParams.get("order");

  let notebookNameForZip = "notebook";
  let phrases: PhraseRow[] = [];
  let segments: AudioSegmentRow[] = [];

  if (!isVirtual) {
    // Fetch notebook
    const notebook = await fetchNotebook(supabase, notebookId, userId);
    notebookNameForZip = notebook.name;
    const buildId = notebook.current_build_id;
    if (!buildId) {
      throw ApiErrors.validationError(
        "Brak gotowego buildu audio dla tego notatnika. Wygeneruj audio przed eksportem."
      );
    }

    // Fetch phrases (optionally filtered by difficulty to match UI)
    phrases = await fetchPhrasesForNotebookWithDifficultyFilter(supabase, notebookId, difficultyParam);

    // Fetch audio segments
    const phraseIds = phrases.map((p) => p.id);
    segments = await fetchAudioSegments(supabase, buildId, phraseIds);
  } else {
    notebookNameForZip = getVirtualNotebookName(notebookId);

    const phrasesVirtual = await fetchPhrasesForVirtualNotebook(
      supabase,
      userId,
      notebookId,
      onlyPinned,
      selectedNotebookIds,
      sortParam,
      orderParam
    );
    phrases = phrasesVirtual;

    // Resolve build IDs for notebooks involved (skip those without builds)
    const notebookIdsInPhrases = Array.from(new Set(phrasesVirtual.map((p) => p.notebook_id)));
    if (notebookIdsInPhrases.length > 0) {
      const { data: notebooks, error: notebooksError } = await supabase
        .from("notebooks")
        .select("id, current_build_id")
        .eq("user_id", userId)
        .in("id", notebookIdsInPhrases);

      if (notebooksError) {
        console.error("[export-zip] Database error fetching notebooks for virtual export:", notebooksError);
        throw ApiErrors.internal("Failed to fetch notebooks");
      }

      const buildIds = Array.from(
        new Set((notebooks || []).map((nb) => nb.current_build_id).filter((id): id is string => Boolean(id)))
      );

      const phraseIds = phrasesVirtual.map((p) => p.id);
      segments = await fetchAudioSegmentsForBuilds(supabase, buildIds, phraseIds);
    } else {
      segments = [];
    }
  }

  // Filter exportable phrases
  const exportablePhrases = selectExportablePhrases(phrases, segments);

  if (exportablePhrases.length === 0) {
    throw ApiErrors.validationError(
      "Brak fraz z kompletnymi segmentami audio. Wygeneruj audio dla wszystkich fraz przed eksportem."
    );
  }

  // Estimate ZIP size
  const estimatedSize = estimateZipSize(exportablePhrases);
  if (estimatedSize > ZIP_SIZE_LIMIT_BYTES) {
    throw ApiErrors.limitExceeded("Eksport przekracza limit 30 MB. Zmniejsz liczbę fraz lub skróć notatnik.");
  }

  // Mark export (rate limiting)
  markExport(userId, notebookId);

  // Get storage client
  const storageClient = getStorageClient(context, supabase);

  // Create ZIP archive
  const archive = archiver("zip", { zlib: { level: 9 } });
  const exportDate = new Date();

  // Add phrases markdown (import-compatible format)
  const phrasesMd = buildPhrasesMarkdown(phrases);
  const phrasesMdFilename = `phrases-${sanitizeNotebookName(notebookNameForZip)}.md`;
  archive.append(phrasesMd, { name: phrasesMdFilename });

  // Process each exportable phrase
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < exportablePhrases.length; i++) {
    const exportablePhrase = exportablePhrases[i];
    const indexInZip = i + 1; // 1-based index

    try {
      console.log(`[export-zip] Processing phrase ${i + 1}/${exportablePhrases.length}: ${exportablePhrase.phrase.id}`);

      // Create combined MP3
      const mp3Buffer = await createPhraseMp3(storageClient, exportablePhrase);

      if (!mp3Buffer || mp3Buffer.length === 0) {
        console.error(`[export-zip] Empty MP3 buffer for phrase ${exportablePhrase.phrase.id}`);
        errorCount++;
        continue;
      }

      // Build filename
      const filename = buildPhraseFilename(indexInZip, exportablePhrase.phrase.en_text, exportDate);
      console.log(`[export-zip] Adding to ZIP: ${filename} (${mp3Buffer.length} bytes)`);

      // Add to ZIP
      archive.append(mp3Buffer, { name: filename });
      successCount++;
    } catch (error) {
      console.error(`[export-zip] Error processing phrase ${exportablePhrase.phrase.id}:`, error);
      errorCount++;
      // Skip this phrase and continue with others
      continue;
    }
  }

  console.log(`[export-zip] Processed ${successCount} phrases successfully, ${errorCount} errors`);

  if (successCount === 0) {
    throw ApiErrors.internal("Nie udało się wygenerować żadnego pliku MP3. Sprawdź logi serwera.");
  }

  // Finalize archive
  archive.finalize();

  // Convert archiver stream to Web ReadableStream
  const stream = new ReadableStream({
    start(controller) {
      archive.on("data", (chunk: Buffer) => {
        controller.enqueue(chunk);
      });
      archive.on("end", () => {
        controller.close();
      });
      archive.on("error", (err) => {
        controller.error(err);
      });
    },
  });

  // Return streaming response
  const notebookNameSanitized = sanitizeNotebookName(notebookNameForZip);

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${notebookNameSanitized}.zip"`,
    },
  });
}

export const GET = withErrorHandling(handleExport);
