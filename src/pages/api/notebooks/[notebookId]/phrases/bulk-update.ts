import type { APIRoute, APIContext } from "astro";
import type { LocalsWithAuth } from "../../../../../lib/types";
import type { PhraseDifficulty } from "../../../../../types";
import { withErrorHandling, requireAuth, ApiErrors } from "../../../../../lib/errors";
import { ensureUserExists, getSupabaseClient, isVirtualNotebook } from "../../../../../lib/utils";

export const prerender = false;

interface BulkUpdatePhrasesCommand {
  phrase_ids: string[];
  difficulty: PhraseDifficulty | null;
}

interface BulkUpdatePhrasesResultDTO {
  updated: number;
}

// POST /api/notebooks/:notebookId/phrases/bulk-update - Bulk update phrase difficulty
const bulkUpdatePhrases = async (context: APIContext): Promise<Response> => {
  const { locals, params, request } = context;
  const userId = (locals as LocalsWithAuth).userId;
  requireAuth(userId);

  const supabase = getSupabaseClient(context);
  await ensureUserExists(supabase, userId);

  const { notebookId } = params as { notebookId: string };

  const body = await request.json();
  const { phrase_ids, difficulty }: BulkUpdatePhrasesCommand = body;

  // Validate input
  if (!Array.isArray(phrase_ids)) {
    throw ApiErrors.validationError("phrase_ids must be an array");
  }

  if (phrase_ids.length === 0) {
    throw ApiErrors.validationError("phrase_ids array cannot be empty");
  }

  // Size limit: max 500 phrases at once
  if (phrase_ids.length > 500) {
    throw ApiErrors.validationError("Too many phrases. Maximum 500 phrases can be updated at once");
  }

  // Validate difficulty value
  if (difficulty !== null && difficulty !== "easy" && difficulty !== "medium" && difficulty !== "hard") {
    throw ApiErrors.validationError("Difficulty must be 'easy', 'medium', 'hard', or null");
  }

  // Validate each phrase_id
  const uniquePhraseIds = new Set<string>();
  for (const phraseId of phrase_ids) {
    if (!phraseId || typeof phraseId !== "string") {
      throw ApiErrors.validationError("Each phrase_id must be a valid string");
    }

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(phraseId)) {
      throw ApiErrors.validationError(`Invalid phrase_id format: ${phraseId}`);
    }

    // Check for duplicates
    if (uniquePhraseIds.has(phraseId)) {
      throw ApiErrors.validationError(`Duplicate phrase_id: ${phraseId}`);
    }
    uniquePhraseIds.add(phraseId);
  }

  // Check if this is a virtual notebook (Smart List)
  const isVirtual = isVirtualNotebook(notebookId);

  if (isVirtual) {
    // For virtual notebooks, verify that all phrases belong to the user (through their notebooks)
    // Get all user's notebook IDs
    const { data: userNotebooks, error: notebooksError } = await supabase
      .from("notebooks")
      .select("id")
      .eq("user_id", userId);

    if (notebooksError) {
      // eslint-disable-next-line no-console
      console.error("Database error:", notebooksError);
      throw ApiErrors.internal("Failed to fetch user notebooks");
    }

    if (!userNotebooks || userNotebooks.length === 0) {
      throw ApiErrors.validationError("One or more phrases not found");
    }

    const userNotebookIds = userNotebooks.map((nb) => nb.id);

    // Verify all phrases exist and belong to user's notebooks
    const { data: existingPhrases, error: phrasesError } = await supabase
      .from("phrases")
      .select("id")
      .in("notebook_id", userNotebookIds)
      .in("id", Array.from(uniquePhraseIds));

    if (phrasesError) {
      // eslint-disable-next-line no-console
      console.error("Database error:", phrasesError);
      throw ApiErrors.internal("Failed to verify phrases");
    }

    if (!existingPhrases || existingPhrases.length !== uniquePhraseIds.size) {
      throw ApiErrors.validationError("One or more phrases not found or not accessible");
    }
  } else {
    // Regular notebook: validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notebookId)) {
      throw ApiErrors.validationError("Invalid notebook ID format");
    }

    // First verify the notebook exists and belongs to the user
    const { data: notebook, error: notebookError } = await supabase
      .from("notebooks")
      .select("id")
      .eq("id", notebookId)
      .eq("user_id", userId)
      .single();

    if (notebookError || !notebook) {
      throw ApiErrors.notFound("Notebook not found");
    }

    // Verify all phrases exist and belong to this notebook
    const { data: existingPhrases, error: phrasesError } = await supabase
      .from("phrases")
      .select("id")
      .eq("notebook_id", notebookId)
      .in("id", Array.from(uniquePhraseIds));

    if (phrasesError) {
      // eslint-disable-next-line no-console
      console.error("Database error:", phrasesError);
      throw ApiErrors.internal("Failed to verify phrases");
    }

    if (!existingPhrases || existingPhrases.length !== uniquePhraseIds.size) {
      throw ApiErrors.validationError("One or more phrases not found in this notebook");
    }
  }

  // Perform the bulk update
  const { error: updateError } = await supabase
    .from("phrases")
    .update({
      difficulty,
      updated_at: new Date().toISOString(),
    })
    .in("id", Array.from(uniquePhraseIds));

  if (updateError) {
    // eslint-disable-next-line no-console
    console.error("Database error:", updateError);
    throw ApiErrors.internal("Failed to update phrases");
  }

  const response: BulkUpdatePhrasesResultDTO = {
    updated: uniquePhraseIds.size,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

export const POST: APIRoute = withErrorHandling(bulkUpdatePhrases);
