/* eslint-disable @typescript-eslint/no-explicit-any */
import type { APIRoute, APIContext } from "astro";
import type { LocalsWithAuth } from "../../../lib/types";
import { requireAuth, withErrorHandling } from "../../../lib/errors";
import { getSupabaseClient } from "../../../lib/utils";
import { getFlashcardsDay } from "../../../lib/flashcards.service";
export const prerender = false;
export const GET: APIRoute = withErrorHandling(async (context: APIContext) => {
  const userId = (context.locals as LocalsWithAuth).userId;
  requireAuth(userId);
  const db: any = getSupabaseClient(context);
  const now = new Date().toISOString();
  const today = getFlashcardsDay();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [directionsResult, settingsResult, introductionsResult] = await Promise.all([
    db
      .from("flashcard_directions")
      .select("fsrs_state,due_at,reps,flashcards!inner(phrase_id,user_id,status)")
      .eq("flashcards.user_id", userId)
      .eq("flashcards.status", "active"),
    db.from("flashcard_settings").select("*").eq("user_id", userId).maybeSingle(),
    db.from("flashcard_phrase_introductions").select("phrase_id,introduced_on").eq("user_id", userId),
  ]);
  if (directionsResult.error) throw new Error("Failed to load flashcard overview");
  if (settingsResult.error) throw new Error("Failed to load flashcard settings");
  if (introductionsResult.error) throw new Error("Failed to load flashcard introductions");
  const directions = directionsResult.data ?? [];
  const settings = settingsResult.data;
  const introductions = introductionsResult.data ?? [];
  const due = (directions ?? []).filter((d: any) => d.fsrs_state !== "New" && d.due_at <= now).length;
  const overdue = (directions ?? []).filter(
    (d: any) => d.fsrs_state !== "New" && d.due_at < start.toISOString()
  ).length;
  const newPhraseIds = new Set(
    (directions ?? [])
      .filter((direction: any) => direction.fsrs_state === "New" && direction.reps === 0)
      .map((direction: any) => {
        const flashcard = Array.isArray(direction.flashcards) ? direction.flashcards[0] : direction.flashcards;
        return flashcard?.phrase_id;
      })
      .filter(Boolean)
  );
  const introducedPhraseIds = new Set((introductions ?? []).map((item: any) => item.phrase_id));
  const introductionDateByPhrase = new Map(
    (introductions ?? []).map((item: any) => [item.phrase_id, item.introduced_on])
  );
  const newToday = (introductions ?? []).filter((item: any) => item.introduced_on === today).length;
  const hasPendingNew = Array.from(newPhraseIds).some(
    (phraseId) => introductionDateByPhrase.has(phraseId) && introductionDateByPhrase.get(phraseId) !== today
  );
  const config = settings ?? {
    new_phrases_per_batch: 5,
    review_cards_per_batch: 50,
    request_retention: 0.9,
    drill_repetitions: 3,
    difficult_cards_per_training: 10,
  };
  return Response.json({
    due_reviews: due,
    overdue_reviews: overdue,
    new_phrases: newPhraseIds.size,
    new_phrases_today: newToday,
    can_add_new_phrases:
      newToday > 0 &&
      due < config.review_cards_per_batch &&
      overdue <= config.review_cards_per_batch * 2 &&
      !hasPendingNew &&
      Array.from(newPhraseIds).some((phraseId) => !introducedPhraseIds.has(phraseId)),
    settings: config,
  });
});
