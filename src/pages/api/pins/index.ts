import type { APIRoute, APIContext } from "astro";
import type { LocalsWithAuth } from "../../../lib/types";
import { withErrorHandling, requireAuth, ApiErrors } from "../../../lib/errors";
import { validateJsonBody, validateUUID } from "../../../lib/validation.service";
import { getSupabaseClient, ensureUserExists } from "../../../lib/utils";

export const prerender = false;

export interface PinnedNotebookDTO {
  notebook_id: string;
  created_at: string;
}

export interface PinnedNotebooksResponse {
  items: PinnedNotebookDTO[];
}

// GET /api/pins - List pinned notebooks for authenticated user
const getPins = async (context: APIContext): Promise<Response> => {
  const locals = context.locals as LocalsWithAuth;
  requireAuth(locals.userId);

  const supabase = getSupabaseClient(context);

  const { data, error } = await supabase
    .from("pinned_notebooks")
    .select("notebook_id, created_at")
    .eq("user_id", locals.userId)
    .order("created_at", { ascending: false });

  if (error) {
    // eslint-disable-next-line no-console
    console.error("Database error:", error);
    throw ApiErrors.internal("Failed to fetch pinned notebooks");
  }

  const response: PinnedNotebooksResponse = {
    items: (data || []).map((pin) => ({
      notebook_id: pin.notebook_id,
      created_at: pin.created_at,
    })),
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

// POST /api/pins - Pin a notebook
const createPin = async (context: APIContext): Promise<Response> => {
  const locals = context.locals as LocalsWithAuth;
  requireAuth(locals.userId);

  const supabase = getSupabaseClient(context);
  await ensureUserExists(supabase, locals.userId);

  const body = await context.request.json();
  validateJsonBody(body, ["notebook_id"]);

  const { notebook_id } = body;

  // Validate UUID format
  validateUUID(notebook_id, "Notebook ID");

  // Verify the notebook exists and belongs to the user
  const { data: notebook, error: notebookError } = await supabase
    .from("notebooks")
    .select("id")
    .eq("id", notebook_id)
    .eq("user_id", locals.userId)
    .single();

  if (notebookError || !notebook) {
    throw ApiErrors.notFound("Notebook not found");
  }

  // Insert pin
  const { data, error } = await supabase
    .from("pinned_notebooks")
    .insert({
      user_id: locals.userId,
      notebook_id,
    })
    .select("notebook_id, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      // Unique violation - already pinned
      throw ApiErrors.conflict("Notebook is already pinned");
    }
    // eslint-disable-next-line no-console
    console.error("Database error:", error);
    throw ApiErrors.internal("Failed to pin notebook");
  }

  return new Response(JSON.stringify(data), {
    status: 201,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

export const GET: APIRoute = withErrorHandling(getPins);
export const POST: APIRoute = withErrorHandling(createPin);
