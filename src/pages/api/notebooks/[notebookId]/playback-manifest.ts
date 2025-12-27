import type { APIContext } from "astro";
import { z } from "zod";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../db/database.types";
import { ApiErrors } from "../../../../lib/errors";
import type { PlaybackManifestDTO, PlaybackManifestItem, PlaybackManifestSegment } from "../../../../types";
import { getSupabaseClient } from "../../../../lib/utils";

export const prerender = false;

// Validation schemas
const PlaybackSpeedSchema = z.enum(["0.75", "0.9", "1", "1.25"]);
const HighlightSchema = z.enum(["on", "off"]);

// Helper function to get user ID from context
function getUserId(context: APIContext): string {
  const userId = context.locals.userId;
  if (!userId) {
    throw ApiErrors.unauthorized("Authentication required");
  }
  return userId;
}

type Supabase = SupabaseClient<Database>;
type PhraseRow = Pick<
  Database["public"]["Tables"]["phrases"]["Row"],
  "id" | "position" | "en_text" | "pl_text" | "tokens"
>;
type AudioSegmentSelection = Pick<
  Database["public"]["Tables"]["audio_segments"]["Row"],
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
  | "word_timings"
>;
type SignedSegment = AudioSegmentSelection & { url: string };

type ErrorWithCode = Error & { code?: string };

function isErrorWithCode(error: unknown): error is ErrorWithCode {
  return typeof error === "object" && error !== null && "code" in error;
}

interface ParsedQueryParams {
  phraseIds?: string[];
  // Keeping these for future use if the API wants to honour playback hints
  speed?: z.infer<typeof PlaybackSpeedSchema>;
  highlight?: z.infer<typeof HighlightSchema>;
}

// Helper function to parse query parameters
function parseQueryParams(url: URL): ParsedQueryParams {
  const phraseIds = url.searchParams.get("phrase_ids");
  const speed = url.searchParams.get("speed");
  const highlight = url.searchParams.get("highlight");

  return {
    phraseIds: phraseIds ? phraseIds.split(",") : undefined,
    speed: speed ? PlaybackSpeedSchema.parse(speed) : undefined,
    highlight: highlight ? HighlightSchema.parse(highlight) : undefined,
  };
}

function parsePhraseTokens(tokens: PhraseRow["tokens"]): PlaybackManifestItem["phrase"]["tokens"] {
  if (!tokens || typeof tokens !== "object") {
    return null;
  }

  return tokens as unknown as PlaybackManifestItem["phrase"]["tokens"];
}

// Helper function to generate signed URLs for storage
async function generateSignedUrls(
  storageClient: Supabase,
  segments: AudioSegmentSelection[]
): Promise<SignedSegment[]> {
  // Filter only complete segments
  const completeSegments = segments.filter((segment) => segment.status === "complete");

  if (completeSegments.length === 0) {
    return [];
  }

  console.log(`[playback-manifest] Generating signed URLs in bulk for ${completeSegments.length} complete segments...`);

  // Use Supabase bulk API to generate all signed URLs in a single network call.
  // This is significantly faster than issuing one request per segment.
  const paths = completeSegments.map((segment) => segment.path);

  const { data, error } = await storageClient.storage.from("audio").createSignedUrls(paths, 3600); // 1 hour

  if (error) {
    console.error("[playback-manifest] Failed to generate signed URLs in bulk:", error);
    return [];
  }

  if (!data || data.length !== completeSegments.length) {
    console.error("[playback-manifest] Unexpected bulk signed URL response size:", {
      expected: completeSegments.length,
      actual: data?.length ?? 0,
    });
  }

  const signedSegments: SignedSegment[] = [];

  completeSegments.forEach((segment, index) => {
    const signed = data[index];
    if (!signed || !signed.signedUrl) {
      console.error(
        `[playback-manifest] Missing signed URL for segment ${segment.id} (path: ${segment.path}) in bulk response`
      );
      return;
    }

    signedSegments.push({
      ...segment,
      url: signed.signedUrl,
    });
  });

  console.log(
    `[playback-manifest] Successfully generated ${signedSegments.length} signed URLs from ${completeSegments.length} complete segments`
  );

  return signedSegments;
}

// Helper function to order segments by voice slot (EN1→EN2→EN3→PL)
function orderSegmentsBySlot<T extends { voice_slot: string }>(segments: T[]): T[] {
  const slotOrder = ["EN1", "EN2", "EN3", "PL"];
  return segments.sort((a, b) => {
    const aIndex = slotOrder.indexOf(a.voice_slot);
    const bIndex = slotOrder.indexOf(b.voice_slot);
    return aIndex - bIndex;
  });
}

export async function GET(context: APIContext) {
  try {
    getUserId(context);

    const supabase = getSupabaseClient(context);

    // Use service-role client for storage operations when available to bypass storage policies gracefully
    let storageClient: Supabase = supabase;
    const supabaseUrl = process.env.SUPABASE_URL || import.meta.env.SUPABASE_URL || import.meta.env.PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && supabaseServiceKey) {
      storageClient = createClient<Database>(supabaseUrl, supabaseServiceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
      console.log("[playback-manifest] Using service-role storage client");
    } else {
      console.warn(
        "[playback-manifest] Service-role key not available; falling back to request client for storage access"
      );
    }

    // Parse and validate path parameter
    const notebookId = context.params.notebookId;
    if (!notebookId) {
      throw ApiErrors.validationError("Notebook ID is required");
    }

    // Parse query parameters
    const { phraseIds } = parseQueryParams(new URL(context.request.url));

    // Get the current build for the notebook
    const { data: notebook, error: notebookError } = await supabase
      .from("notebooks")
      .select("current_build_id")
      .eq("id", notebookId)
      .single();

    if (notebookError) {
      if (notebookError.code === "PGRST116") {
        throw ApiErrors.notFound("Notebook not found");
      }
      throw ApiErrors.internal("Failed to fetch notebook");
    }

    const currentBuildId = notebook.current_build_id;

    if (!currentBuildId) {
      // No active build, return empty manifest
      const response: PlaybackManifestDTO = {
        notebook_id: notebookId,
        build_id: null,
        sequence: [],
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
      };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
    }

    // Parse difficulty filter from query params
    const url = new URL(context.request.url);
    const difficultyParam = url.searchParams.get("difficulty");

    // Get phrases for the notebook
    let phrasesQuery = supabase
      .from("phrases")
      .select("id, position, en_text, pl_text, tokens, difficulty")
      .eq("notebook_id", notebookId)
      .order("position");

    if (phraseIds && phraseIds.length > 0) {
      phrasesQuery = phrasesQuery.in("id", phraseIds);
    }

    // Apply difficulty filter if provided
    if (difficultyParam) {
      if (difficultyParam === "unset") {
        phrasesQuery = phrasesQuery.is("difficulty", null);
      } else if (difficultyParam === "easy" || difficultyParam === "medium" || difficultyParam === "hard") {
        phrasesQuery = phrasesQuery.eq("difficulty", difficultyParam);
      } else {
        throw ApiErrors.validationError("Invalid difficulty filter. Must be 'easy', 'medium', 'hard', or 'unset'");
      }
    }

    const { data: phrasesData, error: phrasesError } = await phrasesQuery;

    if (phrasesError) {
      throw ApiErrors.internal("Failed to fetch phrases");
    }

    if (!phrasesData || phrasesData.length === 0) {
      // No phrases, return empty manifest
      const response: PlaybackManifestDTO = {
        notebook_id: notebookId,
        build_id: currentBuildId,
        sequence: [],
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
      };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
    }

    // Query segments for this notebook's phrases
    const phrases = phrasesData as PhraseRow[];

    const phraseIdsForQuery = phrases.map((phrase) => phrase.id);

    // Get active audio segments for the current build
    const { data: activeSegmentsData, error: activeSegmentsError } = await supabase
      .from("audio_segments")
      .select(
        `
        id, phrase_id, voice_slot, build_id, path, duration_ms, size_bytes,
        sample_rate_hz, bitrate_kbps, status, error_code, word_timings
      `
      )
      .eq("build_id", currentBuildId)
      .eq("is_active", true)
      .in("phrase_id", phraseIdsForQuery);

    if (activeSegmentsError) {
      console.error("[playback-manifest] Error fetching active segments:", activeSegmentsError);
      throw ApiErrors.internal("Failed to fetch audio segments");
    }

    let segmentsToUse = (activeSegmentsData ?? []) as AudioSegmentSelection[];
    console.log(`[playback-manifest] Found ${segmentsToUse.length} active segments for build ${currentBuildId}`);

    // Fallback: if there are no active segments (some builds might not have been activated),
    // use the latest completed segments for the current build.
    if (segmentsToUse.length === 0) {
      console.log(
        `[playback-manifest] No active segments found, trying fallback: completed segments for build ${currentBuildId}`
      );
      // Query for completed segments in the current build
      const { data: completedSegmentsData, error: completedSegmentsError } = await supabase
        .from("audio_segments")
        .select(
          `
          id, phrase_id, voice_slot, build_id, path, duration_ms, size_bytes,
          sample_rate_hz, bitrate_kbps, status, error_code, word_timings
        `
        )
        .eq("build_id", currentBuildId)
        .eq("status", "complete")
        .in("phrase_id", phraseIdsForQuery);

      if (completedSegmentsError) {
        console.error("[playback-manifest] Error fetching completed segments:", completedSegmentsError);
        throw ApiErrors.internal("Failed to fetch completed audio segments");
      }

      const completedSegments = (completedSegmentsData ?? []) as AudioSegmentSelection[];
      console.log(`[playback-manifest] Found ${completedSegments.length} completed segments in fallback query`);

      if (completedSegments.length > 0) {
        // Best effort: mark these segments as active so future requests use the primary query
        const segmentIds = completedSegments.map((segment) => segment.id);
        const { error: activateError } = await supabase
          .from("audio_segments")
          .update({ is_active: true })
          .in("id", segmentIds);
        if (activateError) {
          console.error("[playback-manifest] Failed to activate segments:", activateError);
        } else {
          console.log(`[playback-manifest] Activated ${segmentIds.length} segments`);
        }

        segmentsToUse = completedSegments;
      } else {
        console.warn(
          `[playback-manifest] No completed segments found either. Build ID: ${currentBuildId}, Phrase IDs: ${phraseIdsForQuery.length}`
        );
      }
    }

    console.log(`[playback-manifest] Using ${segmentsToUse.length} segments. Status breakdown:`, {
      complete: segmentsToUse.filter((s) => s.status === "complete").length,
      failed: segmentsToUse.filter((s) => s.status === "failed").length,
      missing: segmentsToUse.filter((s) => s.status === "missing").length,
    });

    // Generate signed URLs for complete segments
    const signedSegments = await generateSignedUrls(storageClient, segmentsToUse);
    console.log(
      `[playback-manifest] Generated ${signedSegments.length} signed URLs from ${segmentsToUse.length} segments`
    );

    // Group segments by phrase
    const segmentsByPhrase = new Map<string, SignedSegment[]>();
    for (const segment of signedSegments) {
      const existingSegments = segmentsByPhrase.get(segment.phrase_id);
      if (existingSegments) {
        existingSegments.push(segment);
      } else {
        segmentsByPhrase.set(segment.phrase_id, [segment]);
      }
    }

    // Build the sequence
    const sequence = phrases.map((phrase): PlaybackManifestItem => {
      const phraseSegments = segmentsByPhrase.get(phrase.id) || [];
      const orderedSegments = orderSegmentsBySlot(phraseSegments);
      const phraseTokens = parsePhraseTokens(phrase.tokens);

      return {
        phrase: {
          id: phrase.id,
          position: phrase.position,
          en_text: phrase.en_text,
          pl_text: phrase.pl_text,
          tokens: phraseTokens,
          difficulty: phrase.difficulty,
        },
        segments: orderedSegments.map(
          (segment): PlaybackManifestSegment => ({
            slot: segment.voice_slot,
            status: "complete",
            url: segment.url,
            duration_ms: segment.duration_ms,
            word_timings: (segment.word_timings as PlaybackManifestSegment["word_timings"]) ?? null,
          })
        ),
      };
    });

    const response: PlaybackManifestDTO = {
      notebook_id: notebookId,
      build_id: currentBuildId,
      sequence,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response(
        JSON.stringify({
          error: {
            code: "validation_error",
            message: "Invalid query parameters",
            details: error.errors,
          },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    if (isErrorWithCode(error)) {
      const status = error.code === "unauthorized" ? 401 : error.code === "not_found" ? 404 : 400;
      return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: { code: "internal", message: "Internal server error" } }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
