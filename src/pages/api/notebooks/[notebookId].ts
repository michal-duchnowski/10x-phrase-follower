import { removePhraseImage } from "../../../lib/phrase-image-storage";
import type { APIRoute, APIContext } from "astro";
import type { UpdateNotebookCommand } from "../../../types";
import type { LocalsWithAuth } from "../../../lib/types";
import { withErrorHandling, requireAuth, ApiErrors } from "../../../lib/errors";
import { ensureUserExists, getSupabaseClient } from "../../../lib/utils";

export const prerender = false;

// GET /api/notebooks/:notebookId - Get notebook by ID
const getNotebook = async (context: APIContext): Promise<Response> => {
  const locals = context.locals as LocalsWithAuth;
  requireAuth(locals.userId);

  const { notebookId } = context.params as { notebookId: string };

  // Validate UUID format
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notebookId)) {
    throw ApiErrors.validationError("Invalid notebook ID format");
  }

  const supabase = getSupabaseClient(context);

  const { data, error } = await supabase
    .from("notebooks")
    .select("id, name, current_build_id, last_generate_job_id, created_at, updated_at")
    .eq("id", notebookId)
    .eq("user_id", locals.userId) // RLS will handle this, but explicit check for clarity
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // No rows returned - notebook not found or not owned by user
      throw ApiErrors.notFound("Notebook not found");
    }
    // eslint-disable-next-line no-console
    console.error("Database error:", error);
    throw ApiErrors.internal("Failed to fetch notebook");
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

// PATCH /api/notebooks/:notebookId - Update notebook
const updateNotebook = async (context: APIContext): Promise<Response> => {
  const locals = context.locals as LocalsWithAuth;
  requireAuth(locals.userId);

  const { notebookId } = context.params as { notebookId: string };

  // Validate UUID format
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notebookId)) {
    throw ApiErrors.validationError("Invalid notebook ID format");
  }

  const body = await context.request.json();
  const { name }: UpdateNotebookCommand = body;

  // Validate input
  if (name !== undefined) {
    if (typeof name !== "string") {
      throw ApiErrors.validationError("Name must be a string");
    }
    if (name.length < 1 || name.length > 100) {
      throw ApiErrors.validationError("Name must be between 1 and 100 characters");
    }
  }

  const supabase = getSupabaseClient(context);
  await ensureUserExists(supabase, locals.userId);

  // Build update object
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) {
    updateData.name = name.trim();
  }
  updateData.updated_at = new Date().toISOString();

  if (Object.keys(updateData).length === 1) {
    // Only updated_at was set, no actual changes
    throw ApiErrors.validationError("No valid fields to update");
  }

  const { data, error } = await supabase
    .from("notebooks")
    .update(updateData)
    .eq("id", notebookId)
    .eq("user_id", locals.userId) // RLS will handle this, but explicit check for clarity
    .select("id, name, current_build_id, last_generate_job_id, created_at, updated_at")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // No rows returned - notebook not found or not owned by user
      throw ApiErrors.notFound("Notebook not found");
    }
    if (error.code === "23505") {
      // Unique violation - notebook name already exists for this user
      throw ApiErrors.uniqueViolation("Notebook name already exists");
    }
    // eslint-disable-next-line no-console
    console.error("Database error:", error);
    throw ApiErrors.internal("Failed to update notebook");
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

// DELETE /api/notebooks/:notebookId - Delete notebook
const deleteNotebook = async (context: APIContext): Promise<Response> => {
  const locals = context.locals as LocalsWithAuth;
  requireAuth(locals.userId);

  const { notebookId } = context.params as { notebookId: string };

  // Validate UUID format
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notebookId)) {
    throw ApiErrors.validationError("Invalid notebook ID format");
  }

  const supabase = getSupabaseClient(context);
  await ensureUserExists(supabase, locals.userId);

  // First, verify the notebook exists and belongs to the user
  const { data: notebook, error: notebookError } = await supabase
    .from("notebooks")
    .select("id, user_id")
    .eq("id", notebookId)
    .eq("user_id", locals.userId)
    .single();

  if (notebookError || !notebook) {
    if (notebookError?.code === "PGRST116") {
      throw ApiErrors.notFound("Notebook not found");
    }
    // eslint-disable-next-line no-console
    console.error("Database error:", notebookError);
    throw ApiErrors.internal("Failed to verify notebook");
  }

  // Delete all audio files associated with this notebook from storage
  // Structure: audio/{userId}/{notebookId}/{phraseId}/{voice}.mp3
  const storagePrefix = `${locals.userId}/${notebookId}`;
  const filesToDelete: string[] = [];

  try {
    // Recursively collect all files in the notebook folder
    const collectFiles = async (path: string): Promise<void> => {
      const { data: items, error: listErr } = await supabase.storage.from("audio").list(path, {
        limit: 1000,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      });

      if (listErr) {
        // Folder might not exist or be empty, which is fine
        return;
      }

      if (!items || items.length === 0) {
        return;
      }

      for (const item of items) {
        const fullPath = path ? `${path}/${item.name}` : item.name;

        // In Supabase Storage, items with id are files, items without id are folders
        if (item.id) {
          // It's a file - add to deletion list
          filesToDelete.push(fullPath);
        } else {
          // It's a folder - recurse into it to find all files
          await collectFiles(fullPath);
        }
      }
    };

    // Start collecting files from the notebook folder
    await collectFiles(storagePrefix);

    // Delete all collected files in batches (Supabase might have limits)
    if (filesToDelete.length > 0) {
      // Delete in batches of 100 to avoid potential limits
      const batchSize = 100;
      for (let i = 0; i < filesToDelete.length; i += batchSize) {
        const batch = filesToDelete.slice(i, i + batchSize);
        const { error: deleteError } = await supabase.storage.from("audio").remove(batch);

        if (deleteError) {
          // eslint-disable-next-line no-console
          console.error(`Error deleting storage files batch ${i / batchSize + 1}:`, deleteError);
          // Continue with other batches even if one fails
        }
      }
      // eslint-disable-next-line no-console
      console.log(`Deleted ${filesToDelete.length} audio files for notebook ${notebookId}`);
    }
  } catch (storageError) {
    // eslint-disable-next-line no-console
    console.error("Unexpected error during storage cleanup:", storageError);
    // Continue with database deletion even if storage cleanup fails
  }

  const { data: phraseImages, error: imageLookupError } = await supabase
    .from("phrases")
    .select("image_url")
    .eq("notebook_id", notebookId);
  if (imageLookupError) throw ApiErrors.internal("Failed to list notebook images");

  // Delete the notebook from database (cascade will handle related records)
  const { error } = await supabase.from("notebooks").delete().eq("id", notebookId).eq("user_id", locals.userId);

  if (error) {
    // eslint-disable-next-line no-console
    console.error("Database error:", error);
    throw ApiErrors.internal("Failed to delete notebook");
  }

  for (const phrase of phraseImages ?? []) await removePhraseImage(locals.userId, phrase.image_url);
  return new Response(null, { status: 204 });
};

export const GET: APIRoute = withErrorHandling(getNotebook);
export const PATCH: APIRoute = withErrorHandling(updateNotebook);
export const DELETE: APIRoute = withErrorHandling(deleteNotebook);
