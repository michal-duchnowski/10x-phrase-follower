import type { APIRoute } from "astro";
import { ApiErrors, requireAuth, withErrorHandling } from "../../../../lib/errors";
import { getSupabaseClient } from "../../../../lib/utils";
import { readUpload, savePhraseImage, removePhraseImage } from "../../../../lib/phrase-image-storage";

export const prerender = false;
export const POST: APIRoute = withErrorHandling(async (context) => {
  const userId = context.locals.userId;
  requireAuth(userId);
  const { phraseId } = context.params;
  if (!phraseId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(phraseId))
    throw ApiErrors.validationError("Invalid phrase ID");
  const db = getSupabaseClient(context);
  const { data: phrase, error } = await db
    .from("phrases")
    .select("id, image_url, notebooks!inner(user_id)")
    .eq("id", phraseId)
    .eq("notebooks.user_id", userId)
    .single();
  if (error || !phrase) throw ApiErrors.notFound("Phrase not found");
  const imageUrl = await savePhraseImage(userId, phraseId, await readUpload(context.request));
  // Compare-and-swap prevents simultaneous uploads from leaving unused files.
  let query = db
    .from("phrases")
    .update({ image_url: imageUrl, updated_at: new Date().toISOString() })
    .eq("id", phraseId);
  query = phrase.image_url === null ? query.is("image_url", null) : query.eq("image_url", phrase.image_url);
  const { data: updated, error: updateError } = await query.select("image_url, learning_hint_markdown").single();
  if (updateError || !updated) {
    await removePhraseImage(userId, imageUrl);
    throw ApiErrors.conflict("Image changed or phrase was deleted. Please retry.");
  }
  await removePhraseImage(userId, phrase.image_url);
  return Response.json(updated);
});
