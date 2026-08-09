/* eslint-disable @typescript-eslint/no-explicit-any */
import type { APIRoute, APIContext } from "astro";
import type { LocalsWithAuth } from "../../../../lib/types";
import { ApiErrors, requireAuth, withErrorHandling } from "../../../../lib/errors";
import { getSupabaseClient } from "../../../../lib/utils";

export const prerender = false;
export const POST: APIRoute = withErrorHandling(async (context: APIContext) => {
  const userId = (context.locals as LocalsWithAuth).userId;
  requireAuth(userId);
  const flashcardId = context.params.flashcardId;
  if (!flashcardId) throw ApiErrors.validationError("Flashcard ID is required");
  const db: any = getSupabaseClient(context);
  const { data, error } = await db
    .from("flashcards")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", flashcardId)
    .eq("user_id", userId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (error) throw ApiErrors.internal("Failed to archive flashcard");
  if (!data) throw ApiErrors.notFound("Flashcard not found");
  return Response.json({ archived: true });
});
