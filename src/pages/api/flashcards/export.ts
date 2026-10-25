/* eslint-disable @typescript-eslint/no-explicit-any */
import type { APIRoute, APIContext } from "astro";
import type { LocalsWithAuth } from "../../../lib/types";
import { ApiErrors, requireAuth, withErrorHandling } from "../../../lib/errors";
import { getSupabaseClient } from "../../../lib/utils";
import { buildFlashcardsMarkdown, type FlashcardExportRow } from "../../../lib/flashcards-export";
import { createExportFilename } from "../../../lib/export-filename";

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
  const mode = context.url.searchParams.get("mode") ?? "all";
  if (mode !== "all" && mode !== "difficult") {
    throw ApiErrors.validationError("Mode must be all or difficult");
  }
  const limitText = context.url.searchParams.get("limit") ?? "20";
  const limit = Number(limitText);
  if (mode === "difficult" && (!/^\d+$/.test(limitText) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)) {
    throw ApiErrors.validationError("Limit must be an integer between 1 and 1000");
  }
  const selectedDirection = context.url.searchParams.get("direction") ?? "all";
  const period = context.url.searchParams.get("period") ?? "all";
  if (mode === "difficult") {
    if (!["all", "pl_to_en", "en_to_pl"].includes(selectedDirection)) {
      throw ApiErrors.validationError("Direction must be all, pl_to_en or en_to_pl");
    }
    if (!["all", "7", "30"].includes(period)) {
      throw ApiErrors.validationError("Period must be all, 7 or 30 days");
    }
  }
  const db: any = getSupabaseClient(context);
  const [directions, reviews] = await Promise.all([
    fetchAll(
      db
        .from("flashcard_directions")
        .select(
          "id, direction, fsrs_state, stability, difficulty, reps, lapses, due_at, last_review_at, flashcards!inner(status, user_id, phrases!inner(en_text, pl_text))"
        )
        .eq("flashcards.user_id", userId)
        .order("id", { ascending: true })
    ),
    fetchAll(
      db
        .from("flashcard_reviews")
        .select("flashcard_direction_id, fsrs_rating, reviewed_at")
        .eq("user_id", userId)
        .order("reviewed_at", { ascending: false })
        .order("id", { ascending: true })
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
  const cutoff = period === "all" ? -Infinity : now - Number(period) * 86400000;
  const exportDirections =
    mode === "difficult"
      ? directions.filter((direction) => {
          const flashcard = Array.isArray(direction.flashcards) ? direction.flashcards[0] : direction.flashcards;
          return (
            flashcard.status === "active" &&
            (selectedDirection === "all" || direction.direction === selectedDirection) &&
            (historyByDirection.get(direction.id) ?? []).some(
              (review) =>
                (review.fsrs_rating === "Again" || review.fsrs_rating === "Hard") &&
                new Date(review.reviewed_at).getTime() >= cutoff &&
                new Date(review.reviewed_at).getTime() <= now
            )
          );
        })
      : directions;
  const rows: FlashcardExportRow[] = exportDirections.map((direction) => {
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
  rows.sort((a, b) => b.score - a.score || b.lapses - a.lapses || a.enText.localeCompare(b.enText, "en"));
  const selectedRows = mode === "difficult" ? rows.slice(0, limit) : rows;
  const markdown = buildFlashcardsMarkdown(selectedRows, new Date(now), mode);
  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${createExportFilename(mode === "difficult" ? `flashcards-difficult-${selectedDirection}-${period === "all" ? "all-time" : `${period}d`}` : "flashcards-all")}"`,
      "X-Flashcard-Count": String(selectedRows.length),
      "Cache-Control": "no-store",
    },
  });
});
