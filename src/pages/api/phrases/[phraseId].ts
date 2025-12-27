import type { APIRoute, APIContext } from "astro";
import type { UpdatePhraseCommand } from "../../../types";
import type { LocalsWithAuth } from "../../../lib/types";
import { withErrorHandling, requireAuth, ApiErrors } from "../../../lib/errors";
import { ensureUserExists, getSupabaseClient } from "../../../lib/utils";

export const prerender = false;

// PATCH /api/phrases/:phraseId - Update phrase
const updatePhrase = async (context: APIContext): Promise<Response> => {
  const locals = context.locals as LocalsWithAuth;
  requireAuth(locals.userId);

  const supabase = getSupabaseClient(context);
  await ensureUserExists(supabase, locals.userId);

  const { phraseId } = context.params as { phraseId: string };

  // Validate UUID format
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(phraseId)) {
    throw ApiErrors.validationError("Invalid phrase ID format");
  }

  const body = await context.request.json();
  const { position, en_text, pl_text, tokens, difficulty }: UpdatePhraseCommand = body;

  // Validate input
  if (position !== undefined && (typeof position !== "number" || !Number.isInteger(position))) {
    throw ApiErrors.validationError("Position must be an integer");
  }

  if (en_text !== undefined) {
    if (typeof en_text !== "string") {
      throw ApiErrors.validationError("English text must be a string");
    }
    if (en_text.length < 1 || en_text.length > 2000) {
      throw ApiErrors.validationError("English text must be between 1 and 2000 characters");
    }
  }

  if (pl_text !== undefined) {
    if (typeof pl_text !== "string") {
      throw ApiErrors.validationError("Polish text must be a string");
    }
    if (pl_text.length < 1 || pl_text.length > 2000) {
      throw ApiErrors.validationError("Polish text must be between 1 and 2000 characters");
    }
  }

  if (difficulty !== undefined) {
    if (difficulty !== null && difficulty !== "easy" && difficulty !== "medium" && difficulty !== "hard") {
      throw ApiErrors.validationError("Difficulty must be 'easy', 'medium', 'hard', or null");
    }
  }

  // Build update object
  const updateData: Record<string, unknown> = {};
  if (position !== undefined) {
    updateData.position = position;
  }
  if (en_text !== undefined) {
    updateData.en_text = en_text.trim();
  }
  if (pl_text !== undefined) {
    updateData.pl_text = pl_text.trim();
  }
  if (tokens !== undefined) {
    updateData.tokens = tokens;
  }
  if (difficulty !== undefined) {
    updateData.difficulty = difficulty;
  }
  updateData.updated_at = new Date().toISOString();

  if (Object.keys(updateData).length === 1) {
    // Only updated_at was set, no actual changes
    throw ApiErrors.validationError("No valid fields to update");
  }

  const { data, error } = await supabase
    .from("phrases")
    .update(updateData)
    .eq("id", phraseId)
    .select(
      `
      id, position, en_text, pl_text, tokens, difficulty, created_at, updated_at,
      notebook:notebooks!inner(id, user_id)
    `
    )
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      // No rows returned - phrase not found or not owned by user
      throw ApiErrors.notFound("Phrase not found");
    }
    if (error.code === "23505") {
      // Unique violation - position already exists in this notebook
      throw ApiErrors.conflict("Position already exists in this notebook");
    }
    // eslint-disable-next-line no-console
    console.error("Database error:", error);
    throw ApiErrors.internal("Failed to update phrase");
  }

  // Verify ownership through the joined notebook
  if (data.notebook.user_id !== locals.userId) {
    throw ApiErrors.notFound("Phrase not found");
  }

  // Remove the notebook data from response
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { notebook, ...phraseData } = data;

  return new Response(JSON.stringify(phraseData), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

// DELETE /api/phrases/:phraseId - Delete phrase
const deletePhrase = async (context: APIContext): Promise<Response> => {
  const locals = context.locals as LocalsWithAuth;
  requireAuth(locals.userId);

  const { phraseId } = context.params as { phraseId: string };

  // Validate UUID format
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(phraseId)) {
    throw ApiErrors.validationError("Invalid phrase ID format");
  }

  const supabase = getSupabaseClient(context);
  await ensureUserExists(supabase, locals.userId);

  // First, get the phrase with notebook_id to verify ownership and get notebook_id for audio deletion
  const { data: phrase, error: phraseError } = await supabase
    .from("phrases")
    .select("id, notebook_id")
    .eq("id", phraseId)
    .single();

  if (phraseError || !phrase) {
    if (phraseError?.code === "PGRST116") {
      throw ApiErrors.notFound("Phrase not found");
    }
    // eslint-disable-next-line no-console
    console.error("Database error:", phraseError);
    throw ApiErrors.internal("Failed to verify phrase");
  }

  // Verify ownership through notebook
  const { data: notebook, error: notebookError } = await supabase
    .from("notebooks")
    .select("id, user_id")
    .eq("id", phrase.notebook_id)
    .eq("user_id", locals.userId)
    .single();

  if (notebookError || !notebook) {
    if (notebookError?.code === "PGRST116") {
      throw ApiErrors.notFound("Phrase not found");
    }
    // eslint-disable-next-line no-console
    console.error("Database error:", notebookError);
    throw ApiErrors.internal("Failed to verify notebook ownership");
  }

  // Delete audio files associated with this phrase from storage
  // Structure: audio/{userId}/{notebookId}/{phraseId}/{voice}.mp3
  const audioPath = `${locals.userId}/${phrase.notebook_id}/${phraseId}`;
  const filesToDelete: string[] = [];

  try {
    // List all files in the phrase folder
    const { data: items, error: listErr } = await supabase.storage.from("audio").list(audioPath, {
      limit: 1000,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    });

    if (!listErr && items) {
      for (const item of items) {
        // In Supabase Storage, items with id are files
        if (item.id) {
          const fullPath = `${audioPath}/${item.name}`;
          filesToDelete.push(fullPath);
        }
      }
    }

    // Delete all collected files
    if (filesToDelete.length > 0) {
      const { error: deleteError } = await supabase.storage.from("audio").remove(filesToDelete);

      if (deleteError) {
        // eslint-disable-next-line no-console
        console.error("Error deleting audio files:", deleteError);
        // Continue with database deletion even if storage cleanup fails
      } else {
        // eslint-disable-next-line no-console
        console.log(`Deleted ${filesToDelete.length} audio files for phrase ${phraseId}`);
      }
    }
  } catch (storageError) {
    // eslint-disable-next-line no-console
    console.error("Unexpected error during storage cleanup:", storageError);
    // Continue with database deletion even if storage cleanup fails
  }

  // Delete the phrase from database (cascade will handle related records like audio_segments)
  const { error } = await supabase.from("phrases").delete().eq("id", phraseId);

  if (error) {
    // eslint-disable-next-line no-console
    console.error("Database error:", error);
    throw ApiErrors.internal("Failed to delete phrase");
  }

  return new Response(null, { status: 204 });
};

export const PATCH: APIRoute = withErrorHandling(updatePhrase);
export const DELETE: APIRoute = withErrorHandling(deletePhrase);
