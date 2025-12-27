import type { APIRoute, APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../db/database.types";
import type { LocalsWithAuth } from "../../../../lib/types";
import { withErrorHandling, requireAuth, ApiErrors } from "../../../../lib/errors";
import { getSupabaseClient } from "../../../../lib/utils";
import { validateUUID } from "../../../../lib/validation.service";
import type { LearnManifestDTO, LearnPhraseAudioAvailability } from "../../../../types";

export const prerender = false;

type Supabase = SupabaseClient<Database>;

async function fetchNotebookForUser(supabase: Supabase, notebookId: string, userId: string) {
  const { data: notebook, error } = await supabase
    .from("notebooks")
    .select("id, user_id")
    .eq("id", notebookId)
    .eq("user_id", userId)
    .single();

  if (error || !notebook) {
    throw ApiErrors.notFound("Notebook not found");
  }

  return notebook;
}

async function fetchPhrasesForNotebook(supabase: Supabase, notebookId: string, difficultyFilter?: string) {
  let query = supabase
    .from("phrases")
    .select("id, position, en_text, pl_text, tokens, difficulty")
    .eq("notebook_id", notebookId)
    .order("position");

  // Apply difficulty filter if provided
  if (difficultyFilter) {
    if (difficultyFilter === "unset") {
      query = query.is("difficulty", null);
    } else if (difficultyFilter === "easy" || difficultyFilter === "medium" || difficultyFilter === "hard") {
      query = query.eq("difficulty", difficultyFilter);
    } else {
      throw ApiErrors.validationError("Invalid difficulty filter. Must be 'easy', 'medium', 'hard', or 'unset'");
    }
  }

  const { data, error } = await query;

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[learn-manifest] Failed to fetch phrases:", error);
    throw ApiErrors.internal("Failed to fetch phrases for learn mode");
  }

  return data ?? [];
}

async function fetchAudioAvailability(
  supabase: Supabase,
  notebookId: string,
  phraseIds: string[]
): Promise<Map<string, LearnPhraseAudioAvailability>> {
  if (phraseIds.length === 0) {
    return new Map();
  }

  // First, resolve the current build for the notebook
  const { data: notebook, error: notebookError } = await supabase
    .from("notebooks")
    .select("current_build_id")
    .eq("id", notebookId)
    .single();

  if (notebookError) {
    // eslint-disable-next-line no-console
    console.error("[learn-manifest] Failed to fetch notebook build info:", notebookError);
    throw ApiErrors.internal("Failed to fetch audio availability");
  }

  const currentBuildId = notebook.current_build_id;

  if (!currentBuildId) {
    // No active build – treat as no audio available
    return new Map();
  }

  // Query active segments for current build and notebook phrases
  const { data: segments, error: segmentsError } = await supabase
    .from("audio_segments")
    .select("phrase_id, voice_slot, status")
    .eq("build_id", currentBuildId)
    .in("phrase_id", phraseIds);

  if (segmentsError) {
    // eslint-disable-next-line no-console
    console.error("[learn-manifest] Failed to fetch audio segments:", segmentsError);
    throw ApiErrors.internal("Failed to fetch audio availability");
  }

  const availability = new Map<string, LearnPhraseAudioAvailability>();

  for (const phraseId of phraseIds) {
    availability.set(phraseId, {
      has_en_audio: false,
      has_pl_audio: false,
    });
  }

  for (const segment of segments ?? []) {
    if (segment.status !== "complete") {
      continue;
    }

    const phraseAvailability = availability.get(segment.phrase_id);
    if (!phraseAvailability) {
      continue;
    }

    if (segment.voice_slot === "PL") {
      phraseAvailability.has_pl_audio = true;
    } else if (segment.voice_slot === "EN1" || segment.voice_slot === "EN2" || segment.voice_slot === "EN3") {
      phraseAvailability.has_en_audio = true;
    }
  }

  return availability;
}

const getLearnManifest = async (context: APIContext): Promise<Response> => {
  const locals = context.locals as LocalsWithAuth;
  requireAuth(locals.userId);

  const supabase = getSupabaseClient(context);

  const { notebookId } = context.params as { notebookId: string };

  validateUUID(notebookId, "Notebook ID");

  await fetchNotebookForUser(supabase, notebookId, locals.userId);

  // Parse difficulty filter from query params
  const url = new URL(context.request.url);
  const difficultyParam = url.searchParams.get("difficulty");

  const phrases = await fetchPhrasesForNotebook(supabase, notebookId, difficultyParam || undefined);

  if (phrases.length === 0) {
    const emptyResponse: LearnManifestDTO = {
      notebook_id: notebookId,
      phrase_count: 0,
      phrases: [],
    };

    return new Response(JSON.stringify(emptyResponse), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  const phraseIds = phrases.map((p) => p.id);
  const availability = await fetchAudioAvailability(supabase, notebookId, phraseIds);

  const response: LearnManifestDTO = {
    notebook_id: notebookId,
    phrase_count: phrases.length,
    phrases: phrases.map((phrase) => {
      const audio = availability.get(phrase.id) ?? {
        has_en_audio: false,
        has_pl_audio: false,
      };

      return {
        id: phrase.id,
        position: phrase.position,
        en_text: phrase.en_text,
        pl_text: phrase.pl_text,
        tokens: (phrase.tokens as LearnManifestDTO["phrases"][number]["tokens"]) ?? null,
        difficulty: phrase.difficulty,
        audio,
      };
    }),
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

export const GET: APIRoute = withErrorHandling(getLearnManifest);
