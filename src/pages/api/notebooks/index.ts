import type { APIRoute, APIContext } from "astro";
import { randomUUID } from "node:crypto";
import type { NotebookListResponse, CreateNotebookCommand } from "../../../types";
import type { LocalsWithAuth } from "../../../lib/types";
import { withErrorHandling, requireAuth, ApiErrors } from "../../../lib/errors";
import {
  validatePaginationParams,
  validateSortParams,
  validateSearchQuery,
  validateJsonBody,
  validateNonEmptyText,
  validateRateLimit,
} from "../../../lib/validation.service";
import { ensureUserExists, getSupabaseClient } from "../../../lib/utils";

export const prerender = false;

// GET /api/notebooks - List notebooks for authenticated user
const getNotebooks = async (context: APIContext): Promise<Response> => {
  const { locals, url } = context;
  const userId = (locals as LocalsWithAuth).userId;
  requireAuth(userId);

  // Get authenticated Supabase client
  const supabase = getSupabaseClient(context);

  // Validate query parameters
  const { limit, cursor } = validatePaginationParams(url);
  const { sort, order } = validateSortParams(url, ["updated_at", "created_at", "name"], "updated_at");
  const q = validateSearchQuery(url);
  const difficultyParam = url.searchParams.get("difficulty");

  // Validate difficulty parameter if provided
  if (difficultyParam && difficultyParam !== "easy" && difficultyParam !== "medium" && difficultyParam !== "hard") {
    throw ApiErrors.validationError("Invalid difficulty filter. Must be 'easy', 'medium', or 'hard'");
  }

  // Build query
  let query = supabase
    .from("notebooks")
    .select("id, name, current_build_id, last_generate_job_id, created_at, updated_at")
    .eq("user_id", userId)
    .order(sort, { ascending: order === "asc" })
    .limit(limit + 1); // Get one extra to check if there are more

  // Apply search filter
  if (q) {
    query = query.ilike("name", `%${q}%`);
  }

  // Apply difficulty filter - only return notebooks that have phrases with this difficulty
  if (difficultyParam) {
    // First, get all user's notebook IDs
    const { data: userNotebooks, error: notebooksError } = await supabase
      .from("notebooks")
      .select("id")
      .eq("user_id", userId);

    if (notebooksError) {
      // eslint-disable-next-line no-console
      console.error("Database error fetching user notebooks:", notebooksError);
      throw ApiErrors.internal("Failed to fetch user notebooks");
    }

    if (!userNotebooks || userNotebooks.length === 0) {
      // User has no notebooks, return empty result
      const response: NotebookListResponse = {
        items: [],
        next_cursor: null,
      };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    const userNotebookIds = userNotebooks.map((nb) => nb.id);

    // Get unique notebook IDs that have phrases with this difficulty
    const { data: phrasesData, error: phrasesError } = await supabase
      .from("phrases")
      .select("notebook_id")
      .eq("difficulty", difficultyParam)
      .in("notebook_id", userNotebookIds);

    if (phrasesError) {
      // eslint-disable-next-line no-console
      console.error("Database error fetching notebooks with difficulty:", phrasesError);
      throw ApiErrors.internal("Failed to fetch notebooks with difficulty");
    }

    // Extract unique notebook IDs
    const notebookIdsWithDifficulty = new Set(
      (phrasesData || []).map((p) => p.notebook_id).filter((id): id is string => id !== null)
    );

    if (notebookIdsWithDifficulty.size === 0) {
      // No notebooks have phrases with this difficulty, return empty result
      const response: NotebookListResponse = {
        items: [],
        next_cursor: null,
      };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    // Filter notebooks to only those with phrases of this difficulty
    query = query.in("id", Array.from(notebookIdsWithDifficulty));
  }

  // Apply cursor pagination
  if (cursor) {
    // For cursor-based pagination, we need to decode the cursor
    // For now, using simple offset-based pagination
    const offset = parseInt(cursor) || 0;
    query = query.range(offset, offset + limit);
  }

  const { data, error } = await query;

  if (error) {
    // eslint-disable-next-line no-console
    console.error("Database error:", error);
    throw ApiErrors.internal("Failed to fetch notebooks");
  }

  // Check if there are more results
  const hasMore = data && data.length > limit;
  const items = hasMore ? data.slice(0, limit) : data || [];
  const nextCursor = hasMore ? (parseInt(cursor || "0") + limit).toString() : null;

  const response: NotebookListResponse = {
    items,
    next_cursor: nextCursor,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

// POST /api/notebooks - Create a new notebook
const createNotebook = async (context: APIContext): Promise<Response> => {
  const { locals, request } = context;
  const userId = (locals as LocalsWithAuth).userId;
  requireAuth(userId);

  // Get authenticated Supabase client
  const supabase = getSupabaseClient(context);

  // Ensure user exists in the users table before creating notebook
  // This is needed because users are created in auth.users by Supabase Auth,
  // but we need a corresponding row in the public.users table for foreign key constraints
  await ensureUserExists(supabase, userId);

  // Rate limiting for notebook creation
  validateRateLimit(`create_notebook:${userId}`, 10, 60000); // 10 per minute

  const body = await request.json();
  validateJsonBody(body, ["name"]);

  const { name }: CreateNotebookCommand = body;

  // Validate and sanitize input
  const sanitizedName = validateNonEmptyText(name, "Name");
  if (sanitizedName.length > 100) {
    throw ApiErrors.validationError("Name must be at most 100 characters");
  }

  // Create notebook
  const { data, error } = await supabase
    .from("notebooks")
    .insert({
      id: randomUUID(),
      user_id: userId,
      name: sanitizedName,
    })
    .select("id, name, current_build_id, last_generate_job_id, created_at, updated_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      // Unique violation - notebook name already exists for this user
      throw ApiErrors.uniqueViolation("Notebook name already exists");
    }
    // eslint-disable-next-line no-console
    console.error("Database error:", error);
    throw ApiErrors.internal("Failed to create notebook");
  }

  return new Response(JSON.stringify(data), {
    status: 201,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

export const GET: APIRoute = withErrorHandling(getNotebooks);
export const POST: APIRoute = withErrorHandling(createNotebook);
