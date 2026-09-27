/* eslint-disable @typescript-eslint/no-explicit-any */
import type { APIRoute, APIContext } from "astro";
import type { LocalsWithAuth } from "../../../lib/types";
import { requireAuth, withErrorHandling } from "../../../lib/errors";
import { getSupabaseClient } from "../../../lib/utils";

export const prerender = false;
const RECENT_INCORRECT_WINDOW_DAYS = 90;

export const GET: APIRoute = withErrorHandling(async (context: APIContext) => {
  const userId = (context.locals as LocalsWithAuth).userId;
  requireAuth(userId);
  const params = new URL(context.request.url).searchParams;
  const pool = params.get("pool") ?? "most_difficult";
  if (pool !== "most_difficult" && pool !== "recent_again" && pool !== "frequent_lapses") {
    return new Response(JSON.stringify({ error: "Invalid difficult-card pool" }), { status: 400 });
  }
  const db: any = getSupabaseClient(context);
  const { data: settings } = await db
    .from("flashcard_settings")
    .select("difficult_cards_per_training")
    .eq("user_id", userId)
    .maybeSingle();
  const requestedLimit = params.get("limit");
  if (requestedLimit && (!/^\d+$/.test(requestedLimit) || Number(requestedLimit) < 1 || Number(requestedLimit) > 10)) {
    return new Response(JSON.stringify({ error: "limit must be between 1 and 10" }), { status: 400 });
  }
  const limit = requestedLimit ? Number(requestedLimit) : (settings?.difficult_cards_per_training ?? 10);

  if (pool === "recent_again") {
    const recentSince = new Date(Date.now() - RECENT_INCORRECT_WINDOW_DAYS * 86400000).toISOString();
    // This pool needs only recent failed reviews. Avoid loading every active
    // direction and its full history just to find them.
    const { data: recentReviews, error: recentReviewsError } = await db
      .from("flashcard_reviews")
      .select(
        "flashcard_direction_id, flashcard_id, phrase_id, direction, reviewed_at, flashcards!inner(id, status, user_id, phrases!inner(en_text, pl_text, learning_hint_markdown))"
      )
      .eq("user_id", userId)
      .eq("fsrs_rating", "Again")
      .gte("reviewed_at", recentSince)
      .eq("flashcards.status", "active")
      .order("reviewed_at", { ascending: false })
      .limit(Math.min(2000, Math.max(limit * 20, 200)));
    if (recentReviewsError) throw new Error("Failed to load recent incorrect flashcards");

    const directionIds = Array.from(
      new Set((recentReviews ?? []).map((review: any) => review.flashcard_direction_id).filter(Boolean))
    );
    const { data: recentDirections, error: recentDirectionsError } = directionIds.length
      ? await db.from("flashcard_directions").select("id, lapses, stability, fsrs_state").in("id", directionIds)
      : { data: [], error: null };
    if (recentDirectionsError) throw new Error("Failed to load recent incorrect flashcard details");

    const directionById = new Map((recentDirections ?? []).map((direction: any) => [direction.id, direction]));
    const failuresByPhrase = new Map<string, number>();
    for (const review of recentReviews ?? []) {
      failuresByPhrase.set(review.phrase_id, (failuresByPhrase.get(review.phrase_id) ?? 0) + 1);
    }
    const seenPhraseIds = new Set<string>();
    const items = (recentReviews ?? [])
      .filter((review: any) => {
        if (seenPhraseIds.has(review.phrase_id)) return false;
        seenPhraseIds.add(review.phrase_id);
        return true;
      })
      .slice(0, limit)
      .map((review: any) => {
        const flashcard = Array.isArray(review.flashcards) ? review.flashcards[0] : review.flashcards;
        const phrase = Array.isArray(flashcard.phrases) ? flashcard.phrases[0] : flashcard.phrases;
        const direction = directionById.get(review.flashcard_direction_id);
        return {
          flashcard_id: flashcard.id,
          phrase_id: review.phrase_id,
          direction_id: review.flashcard_direction_id,
          direction: review.direction,
          en_text: phrase.en_text,
          pl_text: phrase.pl_text,
          learning_hint_markdown: phrase.learning_hint_markdown,
          score: 0,
          lapses: direction?.lapses ?? 0,
          stability: Number((direction?.stability ?? 0).toFixed(1)),
          state: direction?.fsrs_state ?? "New",
          recent_again_or_hard: failuresByPhrase.get(review.phrase_id) ?? 1,
        };
      });
    return Response.json({ items });
  }

  const { data: directions, error } = await db
    .from("flashcard_directions")
    .select(
      "id, direction, fsrs_state, stability, difficulty, reps, lapses, due_at, last_review_at, flashcards!inner(id, status, user_id, phrase_id, phrases!inner(en_text, pl_text, learning_hint_markdown))"
    )
    .eq("flashcards.user_id", userId)
    .eq("flashcards.status", "active");
  if (error) throw new Error("Failed to load flashcard difficulty");

  const directionIds = new Set((directions ?? []).map((direction: any) => direction.id));
  // Do not pass every active direction ID in an `in(...)` filter. After a large
  // import that turns into a very long GET URL, which can be rejected by the
  // proxy before PostgREST receives it.
  const { data: reviews, error: reviewsError } = directionIds.size
    ? await db
        .from("flashcard_reviews")
        .select("flashcard_direction_id, fsrs_rating, reviewed_at")
        .eq("user_id", userId)
        .order("reviewed_at", { ascending: false })
        .limit(2000)
    : { data: [], error: null };
  if (reviewsError) throw new Error("Failed to load flashcard review history");

  const reviewsByDirection = new Map<string, any[]>();
  for (const review of reviews ?? []) {
    if (!review.flashcard_direction_id || !directionIds.has(review.flashcard_direction_id)) continue;
    const list = reviewsByDirection.get(review.flashcard_direction_id) ?? [];
    list.push(review);
    reviewsByDirection.set(review.flashcard_direction_id, list);
  }

  const now = Date.now();
  const scoredItems = (directions ?? [])
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
      const item = {
        flashcard_id: flashcard.id,
        phrase_id: flashcard.phrase_id,
        direction_id: direction.id,
        direction: direction.direction,
        en_text: phrase.en_text,
        pl_text: phrase.pl_text,
        learning_hint_markdown: phrase.learning_hint_markdown,
        score: Math.round(score),
        lapses: direction.lapses,
        stability: Number(direction.stability.toFixed(1)),
        state: direction.fsrs_state,
        recent_again_or_hard: history.filter(
          (review) => review.fsrs_rating === "Again" || review.fsrs_rating === "Hard"
        ).length,
      };
      return {
        ...item,
      };
    })
    .filter((item: any) => {
      if (pool === "frequent_lapses") return item.lapses > 0;
      return item.score > 0;
    })
    .sort((a: any, b: any) => {
      if (pool === "frequent_lapses") return b.lapses - a.lapses || b.score - a.score;
      return b.score - a.score;
    });
  const seenPhraseIds = new Set<string>();
  const items = scoredItems
    .filter((item: any) => {
      if (seenPhraseIds.has(item.phrase_id)) return false;
      seenPhraseIds.add(item.phrase_id);
      return true;
    })
    .slice(0, limit);
  return Response.json({ items });
});
