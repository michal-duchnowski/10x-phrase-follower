import type { APIRoute } from "astro";
import { ApiErrors, requireAuth, withErrorHandling } from "../../../../lib/errors";
import { getSupabaseClient } from "../../../../lib/utils";
import { readPhraseImage } from "../../../../lib/phrase-image-storage";

export const prerender = false;
export const GET: APIRoute = withErrorHandling(async (context) => {
  const userId = context.locals.userId;
  requireAuth(userId);
  const { phraseId, filename } = context.params;
  if (!phraseId || !filename) throw ApiErrors.notFound("Image not found");
  const url = `/api/phrase-images/${phraseId}/${filename}`;
  const { data, error } = await getSupabaseClient(context)
    .from("phrases")
    .select("id, notebooks!inner(user_id)")
    .eq("id", phraseId)
    .eq("image_url", url)
    .eq("notebooks.user_id", userId)
    .single();
  if (error || !data) throw ApiErrors.notFound("Image not found");
  try {
    const bytes = await readPhraseImage(userId, url);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw ApiErrors.notFound("Image not found");
    throw error;
  }
});
