/* eslint-disable @typescript-eslint/no-explicit-any */
import type { APIRoute, APIContext } from "astro";
import type { LocalsWithAuth } from "../../../lib/types";
import { ApiErrors, requireAuth, withErrorHandling } from "../../../lib/errors";
import { getSupabaseClient } from "../../../lib/utils";
import {
  checkFlashcardAnswer,
  scheduleReview,
  serializeCard,
  shouldRequireExactEnglishMatch,
  type FsrsRating,
} from "../../../lib/fsrs.service";

export const prerender = false;
const ratings = new Set<FsrsRating>(["Again", "Hard", "Good", "Easy"]);
export const POST: APIRoute = withErrorHandling(async (context: APIContext) => {
  const userId = (context.locals as LocalsWithAuth).userId;
  requireAuth(userId);
  const body = await context.request.json();
  if (
    !body ||
    typeof body.flashcard_direction_id !== "string" ||
    typeof body.user_answer !== "string" ||
    !ratings.has(body.fsrs_rating)
  )
    throw ApiErrors.validationError("Invalid review payload");
  const db: any = getSupabaseClient(context);
  const { data: direction, error } = await db
    .from("flashcard_directions")
    .select("*, flashcards!inner(id,user_id,status,phrase_id,phrases!inner(en_text,pl_text))")
    .eq("id", body.flashcard_direction_id)
    .eq("flashcards.user_id", userId)
    .eq("flashcards.status", "active")
    .single();
  if (error || !direction) throw ApiErrors.notFound("Flashcard direction not found");
  const flashcard = Array.isArray(direction.flashcards) ? direction.flashcards[0] : direction.flashcards;
  const phrase = Array.isArray(flashcard.phrases) ? flashcard.phrases[0] : flashcard.phrases;
  const expected = direction.direction === "en_to_pl" ? phrase.pl_text : phrase.en_text;
  const prompt = direction.direction === "en_to_pl" ? phrase.en_text : phrase.pl_text;
  const checked = checkFlashcardAnswer(body.user_answer, expected, {
    exactOnly: shouldRequireExactEnglishMatch(direction.direction, expected),
  });
  if (!body.user_answer.trim()) checked.kind = "manual";
  const { data: settings } = await db
    .from("flashcard_settings")
    .select("request_retention")
    .eq("user_id", userId)
    .maybeSingle();
  const scheduled = scheduleReview(direction, body.fsrs_rating, new Date(), settings?.request_retention ?? 0.9);
  const next = serializeCard(scheduled.next);
  const { error: writeError } = await db.rpc("record_flashcard_review", {
    p_direction_id: direction.id,
    p_user_id: userId,
    p_rating: body.fsrs_rating,
    p_match: checked.kind,
    p_user_answer: body.user_answer,
    p_expected: expected,
    p_prompt: prompt,
    p_previous: serializeCard(scheduled.previous),
    p_next: next,
    p_log: scheduled.log,
  });
  if (writeError) throw ApiErrors.internal("Failed to save review");
  return Response.json({ match: checked, next_due_at: next.due_at });
});
