import type { APIRoute } from "astro";
import { ApiErrors, requireAuth, withErrorHandling } from "../../../lib/errors";
import { getSupabaseClient } from "../../../lib/utils";

export const prerender = false;
export const POST: APIRoute = withErrorHandling(async (context) => {
  requireAuth(context.locals.userId);
  const { ids } = await context.request.json();
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 200 ||
    ids.some(
      (id) => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    )
  )
    throw ApiErrors.validationError("Provide 1–200 phrase IDs.");
  const { data, error } = await getSupabaseClient(context)
    .from("phrases")
    .select("id, en_text, pl_text, image_url, updated_at, notebooks!inner(user_id)")
    .in("id", ids)
    .eq("notebooks.user_id", context.locals.userId);
  if (error) throw ApiErrors.internal("Could not load phrases.");
  return Response.json({
    items: (data ?? []).map((phrase) => ({
      id: phrase.id,
      en_text: phrase.en_text,
      pl_text: phrase.pl_text,
      image_url: phrase.image_url,
      updated_at: phrase.updated_at,
    })),
  });
});
