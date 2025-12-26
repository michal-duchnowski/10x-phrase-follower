import type { APIRoute, APIContext } from "astro";
import type { CheckAnswerCommand, CheckAnswerResultDTO } from "../../../../../types";
import type { LocalsWithAuth } from "../../../../../lib/types";
import { withErrorHandling, requireAuth, ApiErrors } from "../../../../../lib/errors";
import { validateUUID, validateJsonBody } from "../../../../../lib/validation.service";
import { getSupabaseClient } from "../../../../../lib/utils";
import { compareAnswers } from "../../../../../lib/learn.service";

export const prerender = false;

// POST /api/notebooks/:notebookId/learn/check-answer - Check user answer against correct phrase
const checkAnswer = async (context: APIContext): Promise<Response> => {
  const locals = context.locals as LocalsWithAuth;
  requireAuth(locals.userId);

  const supabase = getSupabaseClient(context);

  const { notebookId } = context.params as { notebookId: string };

  // Validate UUID format
  validateUUID(notebookId, "Notebook ID");

  // Parse and validate request body
  const body = await context.request.json();
  validateJsonBody(body, ["phrase_id", "user_answer", "direction"]);

  const { phrase_id, user_answer, direction, use_contains_mode = false }: CheckAnswerCommand = body;

  // Validate phrase_id
  validateUUID(phrase_id, "Phrase ID");

  // Validate direction
  if (direction !== "en_to_pl" && direction !== "pl_to_en") {
    throw ApiErrors.validationError("Direction must be 'en_to_pl' or 'pl_to_en'");
  }

  // Validate user_answer
  if (typeof user_answer !== "string") {
    throw ApiErrors.validationError("User answer must be a string");
  }

  // Verify notebook exists and belongs to user
  const { data: notebook, error: notebookError } = await supabase
    .from("notebooks")
    .select("id")
    .eq("id", notebookId)
    .eq("user_id", locals.userId)
    .single();

  if (notebookError || !notebook) {
    throw ApiErrors.notFound("Notebook not found");
  }

  // Get the phrase and verify it belongs to this notebook
  const { data: phrase, error: phraseError } = await supabase
    .from("phrases")
    .select("id, en_text, pl_text")
    .eq("id", phrase_id)
    .eq("notebook_id", notebookId)
    .single();

  if (phraseError || !phrase) {
    if (phraseError?.code === "PGRST116") {
      throw ApiErrors.notFound("Phrase not found");
    }
    throw ApiErrors.internal("Failed to fetch phrase");
  }

  // Determine correct answer based on direction
  const correctAnswer = direction === "en_to_pl" ? phrase.pl_text : phrase.en_text;

  // Compare answers using normalization
  const comparison = compareAnswers(user_answer, correctAnswer, use_contains_mode);

  const response: CheckAnswerResultDTO = {
    is_correct: comparison.isCorrect,
    normalized_user: comparison.normalizedUser,
    normalized_correct: comparison.normalizedCorrect,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

export const POST: APIRoute = withErrorHandling(checkAnswer);
