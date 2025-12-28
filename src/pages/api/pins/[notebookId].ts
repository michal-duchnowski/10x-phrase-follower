import type { APIRoute, APIContext } from "astro";
import type { LocalsWithAuth } from "../../../lib/types";
import { withErrorHandling, requireAuth, ApiErrors } from "../../../lib/errors";
import { validateUUID } from "../../../lib/validation.service";
import { getSupabaseClient } from "../../../lib/utils";

export const prerender = false;

// DELETE /api/pins/:notebookId - Unpin a notebook
const deletePin = async (context: APIContext): Promise<Response> => {
  const locals = context.locals as LocalsWithAuth;
  requireAuth(locals.userId);

  const supabase = getSupabaseClient(context);

  const { notebookId } = context.params as { notebookId: string };

  // Validate UUID format
  validateUUID(notebookId, "Notebook ID");

  // Delete pin
  const { error } = await supabase
    .from("pinned_notebooks")
    .delete()
    .eq("user_id", locals.userId)
    .eq("notebook_id", notebookId);

  if (error) {
    // eslint-disable-next-line no-console
    console.error("Database error:", error);
    throw ApiErrors.internal("Failed to unpin notebook");
  }

  return new Response(null, {
    status: 204,
  });
};

export const DELETE: APIRoute = withErrorHandling(deletePin);
