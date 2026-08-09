/* eslint-disable @typescript-eslint/no-explicit-any */
import type { APIRoute, APIContext } from "astro";
import type { LocalsWithAuth } from "../../../lib/types";
import { ApiErrors, requireAuth, withErrorHandling } from "../../../lib/errors";
import { ensureUserExists, getSupabaseClient } from "../../../lib/utils";
export const prerender = false;
export const PATCH: APIRoute = withErrorHandling(async (context: APIContext) => {
  const userId = (context.locals as LocalsWithAuth).userId;
  requireAuth(userId);
  const body = await context.request.json();
  const db: any = getSupabaseClient(context);
  await ensureUserExists(db, userId);
  const update: any = { updated_at: new Date().toISOString() };
  for (const key of ["new_phrases_per_batch", "review_cards_per_batch", "request_retention"])
    if (body[key] !== undefined) update[key] = body[key];
  if (
    (update.new_phrases_per_batch !== undefined &&
      (!Number.isInteger(update.new_phrases_per_batch) ||
        update.new_phrases_per_batch < 0 ||
        update.new_phrases_per_batch > 100)) ||
    (update.review_cards_per_batch !== undefined &&
      (!Number.isInteger(update.review_cards_per_batch) ||
        update.review_cards_per_batch < 1 ||
        update.review_cards_per_batch > 500)) ||
    (update.request_retention !== undefined &&
      (typeof update.request_retention !== "number" ||
        update.request_retention < 0.7 ||
        update.request_retention > 0.98))
  )
    throw ApiErrors.validationError("Invalid settings");
  const { data, error } = await db
    .from("flashcard_settings")
    .upsert({ user_id: userId, ...update })
    .select()
    .single();
  if (error) throw ApiErrors.internal("Failed to save settings");
  return Response.json(data);
});
