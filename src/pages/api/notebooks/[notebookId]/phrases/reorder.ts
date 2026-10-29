import type { APIRoute, APIContext } from "astro";
import type { ReorderPhrasesCommand, ReorderPhrasesResultDTO } from "../../../../../types";
import type { LocalsWithAuth } from "../../../../../lib/types";
import { withErrorHandling, requireAuth, ApiErrors } from "../../../../../lib/errors";
import { ensureUserExists, getSupabaseClient } from "../../../../../lib/utils";

import { MAX_NOTEBOOK_PHRASES } from "../../../../../lib/notebook-limits";

export const prerender = false;

// POST /api/notebooks/:notebookId/phrases:reorder - Bulk reorder phrases
const reorderPhrases = async (context: APIContext): Promise<Response> => {
  const { locals, params, request } = context;
  const userId = (locals as LocalsWithAuth).userId;
  requireAuth(userId);

  const supabase = getSupabaseClient(context);
  await ensureUserExists(supabase, userId);

  const { notebookId } = params as { notebookId: string };

  // Validate UUID format
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notebookId)) {
    throw ApiErrors.validationError("Invalid notebook ID format");
  }

  const body = await request.json();
  const { moves }: ReorderPhrasesCommand = body;

  // Validate input
  if (!Array.isArray(moves)) {
    throw ApiErrors.validationError("Moves must be an array");
  }

  if (moves.length === 0) {
    throw ApiErrors.validationError("Moves array cannot be empty");
  }

  if (moves.length > MAX_NOTEBOOK_PHRASES) {
    throw ApiErrors.validationError(`Too many moves. Maximum ${MAX_NOTEBOOK_PHRASES} phrases can be reordered at once`);
  }

  // Validate each move
  const phraseIds = new Set<string>();
  const positions = new Set<number>();

  for (const move of moves) {
    if (!move.phrase_id || typeof move.phrase_id !== "string") {
      throw ApiErrors.validationError("Each move must have a valid phrase_id");
    }

    if (typeof move.position !== "number" || !Number.isInteger(move.position)) {
      throw ApiErrors.validationError("Each move must have a valid integer position");
    }

    // Check for duplicate phrase IDs
    if (phraseIds.has(move.phrase_id)) {
      throw ApiErrors.validationError("Duplicate phrase_id in moves array");
    }
    phraseIds.add(move.phrase_id);

    // Check for duplicate positions
    if (positions.has(move.position)) {
      throw ApiErrors.validationError("Duplicate position in moves array");
    }
    positions.add(move.position);
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
    .in("id", Array.from(phraseIds));

  if (phrasesError) {
    // eslint-disable-next-line no-console
    console.error("Database error:", phrasesError);
    throw ApiErrors.internal("Failed to verify phrases");
  }

  if (!existingPhrases || existingPhrases.length !== phraseIds.size) {
    throw ApiErrors.validationError("One or more phrases not found in this notebook");
  }

  // Perform the reordering in a transaction
  const updates = moves.map((move) => ({
    id: move.phrase_id,
    position: move.position,
    updated_at: new Date().toISOString(),
  }));

  const { error: updateError } = await supabase.from("phrases").upsert(updates, {
    onConflict: "id",
    ignoreDuplicates: false,
  });

  if (updateError) {
    // eslint-disable-next-line no-console
    console.error("Database error:", updateError);
    throw ApiErrors.internal("Failed to reorder phrases");
  }

  const response: ReorderPhrasesResultDTO = {
    updated: moves.length,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

export const POST: APIRoute = withErrorHandling(reorderPhrases);
