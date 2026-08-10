/* eslint-disable @typescript-eslint/no-explicit-any */
import type { APIRoute, APIContext } from "astro";
import type { LocalsWithAuth } from "../../../lib/types";
import { requireAuth, withErrorHandling } from "../../../lib/errors";
import { ensureUserExists, getSupabaseClient } from "../../../lib/utils";
import { getFlashcardsDay } from "../../../lib/flashcards.service";
export const prerender = false;
export const GET: APIRoute = withErrorHandling(async (context: APIContext) => {
  const userId = (context.locals as LocalsWithAuth).userId;
  requireAuth(userId);
  const db: any = getSupabaseClient(context);
  await ensureUserExists(db, userId);
  const now = new Date().toISOString();
  const today = getFlashcardsDay();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { data: cards } = await db
    .from("flashcards")
    .select("id,phrase_id")
    .eq("user_id", userId)
    .eq("status", "active");
  const cardIds = (cards ?? []).map((card: any) => card.id);
  const { data: directions } = cardIds.length
    ? await db.from("flashcard_directions").select("flashcard_id,fsrs_state,due_at,reps").in("flashcard_id", cardIds)
    : { data: [] };
  const { data: settings } = await db.from("flashcard_settings").select("*").eq("user_id", userId).maybeSingle();
  const due = (directions ?? []).filter((d: any) => d.fsrs_state !== "New" && d.due_at <= now).length;
  const overdue = (directions ?? []).filter(
    (d: any) => d.fsrs_state !== "New" && d.due_at < start.toISOString()
  ).length;
  const flashcardById = new Map((cards ?? []).map((card: any) => [card.id, card]));
  const newPhraseIds = new Set(
    (directions ?? [])
      .filter((direction: any) => direction.fsrs_state === "New" && direction.reps === 0)
      .map((direction: any) => flashcardById.get(direction.flashcard_id)?.phrase_id)
      .filter(Boolean)
  );
  const { data: introductions } = await db
    .from("flashcard_phrase_introductions")
    .select("phrase_id,introduced_on")
    .eq("user_id", userId);
  const introducedPhraseIds = new Set((introductions ?? []).map((item: any) => item.phrase_id));
  const introductionDateByPhrase = new Map(
    (introductions ?? []).map((item: any) => [item.phrase_id, item.introduced_on])
  );
  const newToday = (introductions ?? []).filter((item: any) => item.introduced_on === today).length;
  const hasPendingNew = Array.from(newPhraseIds).some(
    (phraseId) => introductionDateByPhrase.has(phraseId) && introductionDateByPhrase.get(phraseId) !== today
  );
  const config = settings ?? { new_phrases_per_batch: 5, review_cards_per_batch: 50, request_retention: 0.9 };
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
