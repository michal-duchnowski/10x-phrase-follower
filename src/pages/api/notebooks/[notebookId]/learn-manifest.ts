import type { APIRoute, APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../db/database.types";
import type { LocalsWithAuth } from "../../../../lib/types";
import { withErrorHandling, requireAuth, ApiErrors } from "../../../../lib/errors";
import { getSupabaseClient, isVirtualNotebook, getDifficultyFromVirtualNotebook } from "../../../../lib/utils";
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

async function fetchPhrasesForNotebook(
  supabase: Supabase,
  notebookId: string,
  userId: string,
  difficultyFilter?: string,
  onlyPinned?: boolean
) {
  const isVirtual = isVirtualNotebook(notebookId);
  const difficulty = isVirtual ? getDifficultyFromVirtualNotebook(notebookId) : null;

  let query;

  if (isVirtual && difficulty) {
    // Virtual notebook: query all phrases from user's notebooks with matching difficulty
    // First, get notebook IDs (all or pinned only)
    let notebookIds: string[];

    if (onlyPinned) {
      // Get only pinned notebook IDs
      const { data: pinnedNotebooks, error: pinnedError } = await supabase
        .from("pinned_notebooks")
        .select("notebook_id")
        .eq("user_id", userId);

      if (pinnedError) {
        // eslint-disable-next-line no-console
        console.error("[learn-manifest] Failed to fetch pinned notebooks:", pinnedError);
        throw ApiErrors.internal("Failed to fetch pinned notebooks");
      }

      if (!pinnedNotebooks || pinnedNotebooks.length === 0) {
        return [];
      }

      notebookIds = pinnedNotebooks.map((pin) => pin.notebook_id);
    } else {
      // Get all notebook IDs for this user
      const { data: userNotebooks, error: notebooksError } = await supabase
        .from("notebooks")
        .select("id")
        .eq("user_id", userId);

      if (notebooksError) {
        // eslint-disable-next-line no-console
        console.error("[learn-manifest] Failed to fetch user notebooks:", notebooksError);
        throw ApiErrors.internal("Failed to fetch user notebooks");
      }

      if (!userNotebooks || userNotebooks.length === 0) {
        return [];
      }

      notebookIds = userNotebooks.map((nb) => nb.id);
    }

    query = supabase
      .from("phrases")
      .select("id, position, en_text, pl_text, tokens, difficulty, notebook_id")
      .in("notebook_id", notebookIds)
      .eq("difficulty", difficulty)
      .order("created_at", { ascending: false });
  } else {
    // Regular notebook
    query = supabase
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
  phraseIds: string[],
  phrases?: { id: string; notebook_id?: string }[]
): Promise<Map<string, LearnPhraseAudioAvailability>> {
  if (phraseIds.length === 0) {
    return new Map();
  }

  const isVirtual = isVirtualNotebook(notebookId);
  const availability = new Map<string, LearnPhraseAudioAvailability>();

  // Initialize all phrases as no audio
  for (const phraseId of phraseIds) {
    availability.set(phraseId, {
      has_en_audio: false,
      has_pl_audio: false,
    });
  }

  if (isVirtual && phrases) {
    // For virtual notebooks, check audio for each phrase in its original notebook
    // Group phrases by notebook_id
    const phrasesByNotebook = new Map<string, string[]>();
    for (const phrase of phrases) {
      if (phrase.notebook_id) {
        const existing = phrasesByNotebook.get(phrase.notebook_id);
        if (existing) {
          existing.push(phrase.id);
        } else {
          phrasesByNotebook.set(phrase.notebook_id, [phrase.id]);
        }
      }
    }

    // Check audio availability for each notebook
    for (const [originalNotebookId, phraseIdsForNotebook] of phrasesByNotebook) {
      const { data: notebook, error: notebookError } = await supabase
        .from("notebooks")
        .select("current_build_id")
        .eq("id", originalNotebookId)
        .single();

      if (notebookError || !notebook?.current_build_id) {
        continue;
      }

      const { data: segments, error: segmentsError } = await supabase
        .from("audio_segments")
        .select("phrase_id, voice_slot, status")
        .eq("build_id", notebook.current_build_id)
        .eq("is_active", true)
        .in("phrase_id", phraseIdsForNotebook);

      if (segmentsError) {
        continue;
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
    }
  } else {
    // Regular notebook: check audio for current build
    const { data: notebook, error: notebookError } = await supabase
      .from("notebooks")
      .select("current_build_id")
      .eq("id", notebookId)
      .single();

    if (notebookError || !notebook?.current_build_id) {
      return availability;
    }

    const { data: segments, error: segmentsError } = await supabase
      .from("audio_segments")
      .select("phrase_id, voice_slot, status")
      .eq("build_id", notebook.current_build_id)
      .eq("is_active", true)
      .in("phrase_id", phraseIds);

    if (segmentsError) {
      // eslint-disable-next-line no-console
      console.error("[learn-manifest] Failed to fetch audio segments:", segmentsError);
      return availability;
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
  }

  return availability;
}

const getLearnManifest = async (context: APIContext): Promise<Response> => {
  const locals = context.locals as LocalsWithAuth;
  requireAuth(locals.userId);

  const supabase = getSupabaseClient(context);

  const { notebookId } = context.params as { notebookId: string };

  // Check if this is a virtual notebook
  const isVirtual = isVirtualNotebook(notebookId);

  // For regular notebooks, validate UUID and check ownership
  if (!isVirtual) {
    validateUUID(notebookId, "Notebook ID");
    await fetchNotebookForUser(supabase, notebookId, locals.userId);
  }

  // Parse difficulty filter and pinned filter from query params
  const url = new URL(context.request.url);
  const difficultyParam = url.searchParams.get("difficulty");
  const pinnedParam = url.searchParams.get("pinned");
  const onlyPinned = pinnedParam === "1";

  // For virtual notebooks, difficulty is already determined by the notebook ID
  const phrases = await fetchPhrasesForNotebook(
    supabase,
    notebookId,
    locals.userId,
    isVirtual ? undefined : difficultyParam || undefined,
    isVirtual && onlyPinned ? true : undefined
  );

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
  const availability = await fetchAudioAvailability(supabase, notebookId, phraseIds, phrases);

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
