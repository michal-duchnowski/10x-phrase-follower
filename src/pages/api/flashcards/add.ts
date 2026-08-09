/* eslint-disable @typescript-eslint/no-explicit-any */
import type { APIRoute, APIContext } from "astro";
import type { LocalsWithAuth } from "../../../lib/types";
import { ApiErrors, requireAuth, withErrorHandling } from "../../../lib/errors";
import { ensureUserExists, getSupabaseClient } from "../../../lib/utils";

export const prerender = false;
export const POST: APIRoute = withErrorHandling(async (context: APIContext) => {
  const userId = (context.locals as LocalsWithAuth).userId;
  requireAuth(userId);
  const body = await context.request.json();
  const ids = body?.phrase_ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || ids.some((id) => typeof id !== "string"))
    throw ApiErrors.validationError("phrase_ids must contain 1 to 500 IDs");
  const phraseIds = [...new Set(ids)];
  if (phraseIds.length !== ids.length) throw ApiErrors.validationError("phrase_ids must not contain duplicates");
  const db: any = getSupabaseClient(context);
  await ensureUserExists(db, userId);
  const { data: phrases, error } = await db
    .from("phrases")
    .select("id, notebooks!inner(user_id)")
    .in("id", phraseIds)
    .eq("notebooks.user_id", userId);
  if (error || !phrases || phrases.length !== phraseIds.length)
    throw ApiErrors.validationError("One or more phrases are not accessible");
  const { data: existing, error: existingError } = await db
    .from("flashcards")
    .select("id, phrase_id, status")
    .eq("user_id", userId)
    .in("phrase_id", phraseIds);
  if (existingError) throw ApiErrors.internal("Failed to read flashcards");
  const known = new Map((existing ?? []).map((card: any) => [card.phrase_id, card]));
  const missing = phraseIds.filter((id) => !known.has(id));
  if (missing.length) {
    const { error: insertError } = await db
      .from("flashcards")
      .insert(missing.map((phrase_id) => ({ user_id: userId, phrase_id })));
    if (insertError) throw ApiErrors.internal("Failed to add flashcards");
  }
  const archived = (existing ?? []).filter((card: any) => card.status === "archived");
  if (archived.length) {
    const { error: reactivateError } = await db
      .from("flashcards")
      .update({ status: "active", archived_at: null })
      .in(
        "id",
        archived.map((card: any) => card.id)
      );
    if (reactivateError) throw ApiErrors.internal("Failed to reactivate flashcards");
  }
  const { data: allCards, error: allError } = await db
    .from("flashcards")
    .select("id, phrase_id")
    .eq("user_id", userId)
    .in("phrase_id", missing.concat(archived.map((c: any) => c.phrase_id)));
  if (allError) throw ApiErrors.internal("Failed to create flashcard directions");
  const directions = (allCards ?? []).flatMap((card: any) =>
    ["en_to_pl", "pl_to_en"].map((direction) => ({ flashcard_id: card.id, direction }))
  );
  if (directions.length) {
    const { error: directionError } = await db
      .from("flashcard_directions")
      .upsert(directions, { onConflict: "flashcard_id,direction", ignoreDuplicates: true });
    if (directionError) throw ApiErrors.internal("Failed to create flashcard directions");
  }
  return Response.json({
    added: missing.length,
    reactivated: archived.length,
    already_present: phraseIds.length - missing.length - archived.length,
  });
});
