/* eslint-disable @typescript-eslint/no-explicit-any */
import type { APIRoute, APIContext } from "astro";
import type { LocalsWithAuth } from "../../../lib/types";
import { requireAuth, withErrorHandling } from "../../../lib/errors";
import { getSupabaseClient } from "../../../lib/utils";

export const prerender = false;

export const GET: APIRoute = withErrorHandling(async (context: APIContext) => {
  const userId = (context.locals as LocalsWithAuth).userId;
  requireAuth(userId);
  const db: any = getSupabaseClient(context);
  const { data: settings } = await db
    .from("flashcard_settings")
    .select("difficult_cards_per_training")
    .eq("user_id", userId)
    .maybeSingle();
  const limit = settings?.difficult_cards_per_training ?? 10;
  const { data: directions, error } = await db
    .from("flashcard_directions")
    .select(
      "id, direction, fsrs_state, stability, difficulty, reps, lapses, due_at, last_review_at, flashcards!inner(id, status, user_id, phrase_id, phrases!inner(en_text, pl_text))"
    )
    .eq("flashcards.user_id", userId)
    .eq("flashcards.status", "active");
  if (error) throw new Error("Failed to load flashcard difficulty");

  const directionIds = (directions ?? []).map((direction: any) => direction.id);
  const { data: reviews, error: reviewsError } = directionIds.length
    ? await db
        .from("flashcard_reviews")
        .select("flashcard_direction_id, fsrs_rating, reviewed_at")
        .eq("user_id", userId)
        .in("flashcard_direction_id", directionIds)
        .order("reviewed_at", { ascending: false })
        .limit(2000)
    : { data: [], error: null };
  if (reviewsError) throw new Error("Failed to load flashcard review history");

  const reviewsByDirection = new Map<string, any[]>();
  for (const review of reviews ?? []) {
    if (!review.flashcard_direction_id) continue;
    const list = reviewsByDirection.get(review.flashcard_direction_id) ?? [];
    list.push(review);
    reviewsByDirection.set(review.flashcard_direction_id, list);
  }

  const now = Date.now();
  const items = (directions ?? [])
    .map((direction: any) => {
      const history = reviewsByDirection.get(direction.id) ?? [];
      const historyScore = history.reduce((total, review) => {
        const ageDays = Math.max(0, (now - new Date(review.reviewed_at).getTime()) / 86400000);
        const recency = Math.exp(-ageDays / 28);
        const ratingWeight =
          review.fsrs_rating === "Again"
            ? 9
            : review.fsrs_rating === "Hard"
              ? 4
              : review.fsrs_rating === "Good"
                ? -1
                : -2;
        return total + ratingWeight * recency;
      }, 0);
      const overdueDays = Math.max(0, (now - new Date(direction.due_at).getTime()) / 86400000);
      const statePenalty = direction.fsrs_state === "Relearning" ? 12 : direction.fsrs_state === "Learning" ? 4 : 0;
      const score = Math.max(
        0,
        direction.difficulty * 5 +
          direction.lapses * 12 +
          Math.max(0, 12 - direction.stability) * 3 +
          Math.min(12, overdueDays) +
          statePenalty +
          historyScore
      );
      const flashcard = Array.isArray(direction.flashcards) ? direction.flashcards[0] : direction.flashcards;
      const phrase = Array.isArray(flashcard.phrases) ? flashcard.phrases[0] : flashcard.phrases;
      return {
        flashcard_id: flashcard.id,
        phrase_id: flashcard.phrase_id,
        direction_id: direction.id,
        direction: direction.direction,
        en_text: phrase.en_text,
        pl_text: phrase.pl_text,
        score: Math.round(score),
        lapses: direction.lapses,
        stability: Number(direction.stability.toFixed(1)),
        state: direction.fsrs_state,
        recent_again_or_hard: history.filter(
          (review) => review.fsrs_rating === "Again" || review.fsrs_rating === "Hard"
        ).length,
      };
    })
    .filter((item: any) => item.score > 0)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, limit);
  return Response.json({ items });
});
