/* eslint-disable @typescript-eslint/no-explicit-any */
import type { APIRoute, APIContext } from "astro";
import type { LocalsWithAuth } from "../../../lib/types";
import { requireAuth, withErrorHandling } from "../../../lib/errors";
import { getSupabaseClient } from "../../../lib/utils";
import { buildFlashcardsMarkdown, type FlashcardExportRow } from "../../../lib/flashcards-export";

export const prerender = false;
const PAGE_SIZE = 1000;

async function fetchAll(query: any): Promise<any[]> {
  const items: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    items.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return items;
  }
}

function calculateScore(direction: any, history: any[], now: number): number {
  const historyScore = history.reduce((total, review) => {
    const ageDays = Math.max(0, (now - new Date(review.reviewed_at).getTime()) / 86400000);
    const recency = Math.exp(-ageDays / 28);
    const ratingWeight =
      review.fsrs_rating === "Again" ? 9 : review.fsrs_rating === "Hard" ? 4 : review.fsrs_rating === "Good" ? -1 : -2;
    return total + ratingWeight * recency;
  }, 0);
  const overdueDays = Math.max(0, (now - new Date(direction.due_at).getTime()) / 86400000);
  const statePenalty = direction.fsrs_state === "Relearning" ? 12 : direction.fsrs_state === "Learning" ? 4 : 0;
  return Math.round(
    Math.max(
      0,
      direction.difficulty * 5 +
        direction.lapses * 12 +
        Math.max(0, 12 - direction.stability) * 3 +
        Math.min(12, overdueDays) +
        statePenalty +
        historyScore
    )
  );
}

export const GET: APIRoute = withErrorHandling(async (context: APIContext) => {
  const userId = (context.locals as LocalsWithAuth).userId;
  requireAuth(userId);
  const db: any = getSupabaseClient(context);
  const [directions, reviews] = await Promise.all([
    fetchAll(
      db
        .from("flashcard_directions")
        .select(
          "id, direction, fsrs_state, stability, difficulty, reps, lapses, due_at, last_review_at, flashcards!inner(status, user_id, phrases!inner(en_text, pl_text))"
        )
        .eq("flashcards.user_id", userId)
    ),
    fetchAll(
      db
        .from("flashcard_reviews")
        .select("flashcard_direction_id, fsrs_rating, reviewed_at")
        .eq("user_id", userId)
        .order("reviewed_at", { ascending: false })
    ),
  ]);
  const historyByDirection = new Map<string, any[]>();
  for (const review of reviews) {
    if (!review.flashcard_direction_id) continue;
    const history = historyByDirection.get(review.flashcard_direction_id) ?? [];
    history.push(review);
    historyByDirection.set(review.flashcard_direction_id, history);
  }
  const now = Date.now();
  const rows: FlashcardExportRow[] = directions.map((direction) => {
    const flashcard = Array.isArray(direction.flashcards) ? direction.flashcards[0] : direction.flashcards;
    const phrase = Array.isArray(flashcard.phrases) ? flashcard.phrases[0] : flashcard.phrases;
    return {
      direction: direction.direction,
      enText: phrase.en_text,
      plText: phrase.pl_text,
      score: calculateScore(direction, historyByDirection.get(direction.id) ?? [], now),
      state: direction.fsrs_state,
      reps: direction.reps,
      lapses: direction.lapses,
      stability: direction.stability,
      lastReviewAt: direction.last_review_at,
      dueAt: direction.due_at,
      status: flashcard.status,
    };
  });
  const markdown = buildFlashcardsMarkdown(rows);
  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="flashcards.md"',
    },
  });
});
