/* eslint-disable @typescript-eslint/no-explicit-any */
import type { APIRoute, APIContext } from "astro";
import type { LocalsWithAuth } from "../../../lib/types";
import { requireAuth, withErrorHandling } from "../../../lib/errors";
import { ensureUserExists, getSupabaseClient } from "../../../lib/utils";
export const prerender = false;
export const GET: APIRoute = withErrorHandling(async (context: APIContext) => {
  const userId = (context.locals as LocalsWithAuth).userId;
  requireAuth(userId);
  const db: any = getSupabaseClient(context);
  await ensureUserExists(db, userId);
  const now = new Date().toISOString();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { data: cards } = await db.from("flashcards").select("id").eq("user_id", userId).eq("status", "active");
  const cardIds = (cards ?? []).map((card: any) => card.id);
  const { data: directions } = cardIds.length
    ? await db.from("flashcard_directions").select("fsrs_state,due_at,reps").in("flashcard_id", cardIds)
    : { data: [] };
  const { data: settings } = await db.from("flashcard_settings").select("*").eq("user_id", userId).maybeSingle();
  const due = (directions ?? []).filter((d: any) => d.fsrs_state !== "New" && d.due_at <= now).length;
  return Response.json({
    due_reviews: due,
    overdue_reviews: (directions ?? []).filter((d: any) => d.fsrs_state !== "New" && d.due_at < start.toISOString())
      .length,
    new_phrases: (directions ?? []).filter((d: any) => d.fsrs_state === "New" && d.reps === 0).length / 2,
    settings: settings ?? { new_phrases_per_batch: 5, review_cards_per_batch: 50, request_retention: 0.9 },
  });
});
