import type { APIRoute, APIContext } from "astro";
import { randomUUID } from "node:crypto";
import type { CreateSnapshotCommand, CreateSnapshotResultDTO } from "../../../types";
import type { LocalsWithAuth } from "../../../lib/types";
import { withErrorHandling, requireAuth, ApiErrors } from "../../../lib/errors";
import { validateJsonBody, validateArray, validateUUID, validateRateLimit } from "../../../lib/validation.service";
import {
  ensureUserExists,
  getSupabaseClient,
  isVirtualNotebook,
  getDifficultyFromVirtualNotebook,
} from "../../../lib/utils";
import { generatePositions } from "../../../lib/import.service";

export const prerender = false;

// POST /api/notebooks/snapshots - Create a snapshot notebook from selected phrases
const createSnapshot = async (context: APIContext): Promise<Response> => {
  const { locals, request } = context;
  const userId = (locals as LocalsWithAuth).userId;
  requireAuth(userId);

  const supabase = getSupabaseClient(context);
  await ensureUserExists(supabase, userId);

  // Rate limiting for snapshot creation
  validateRateLimit(`create_snapshot:${userId}`, 10, 60000); // 10 per minute

  const body = await request.json();
  validateJsonBody(body, ["source_notebook_id", "phrase_ids"]);

  const { source_notebook_id, phrase_ids }: CreateSnapshotCommand = body;

  // Validate phrase_ids
  const validatedPhraseIds = validateArray(phrase_ids, 1, 100, "phrase_ids");

  // Deduplicate phrase_ids
  const uniquePhraseIds = Array.from(new Set(validatedPhraseIds));

  if (uniquePhraseIds.length === 0) {
    throw ApiErrors.validationError("phrase_ids must contain at least one phrase ID");
  }

  // Validate each phrase_id is a UUID
  for (const phraseId of uniquePhraseIds) {
    if (typeof phraseId !== "string") {
      throw ApiErrors.validationError("Each phrase_id must be a string");
    }
    validateUUID(phraseId, "phrase_id");
  }

  // Validate source_notebook_id
  const isVirtual = isVirtualNotebook(source_notebook_id);

  if (!isVirtual) {
    validateUUID(source_notebook_id, "source_notebook_id");
  }

  // Determine source name and verify phrases belong to user
  let sourceName: string;
  let userNotebookIds: string[];

  if (isVirtual) {
    // Smart List: get difficulty and set source name
    const difficulty = getDifficultyFromVirtualNotebook(source_notebook_id);
    if (!difficulty) {
      throw ApiErrors.validationError("Invalid smart list ID");
    }

    sourceName = difficulty === "easy" ? "All Easy" : difficulty === "medium" ? "All Medium" : "All Hard";

    // Get all user's notebook IDs
    const { data: userNotebooks, error: notebooksError } = await supabase
      .from("notebooks")
      .select("id")
      .eq("user_id", userId);

    if (notebooksError) {
      // eslint-disable-next-line no-console
      console.error("Database error:", notebooksError);
      throw ApiErrors.internal("Failed to fetch user notebooks");
    }

    if (!userNotebooks || userNotebooks.length === 0) {
      throw ApiErrors.validationError("No notebooks found for user");
    }

    userNotebookIds = userNotebooks.map((nb) => nb.id);

    // Verify all phrases exist, belong to user's notebooks, and have matching difficulty
    const { data: existingPhrases, error: phrasesError } = await supabase
      .from("phrases")
      .select("id, notebook_id")
      .in("notebook_id", userNotebookIds)
      .in("id", uniquePhraseIds)
      .eq("difficulty", difficulty);

    if (phrasesError) {
      // eslint-disable-next-line no-console
      console.error("Database error:", phrasesError);
      throw ApiErrors.internal("Failed to verify phrases");
    }

    if (!existingPhrases || existingPhrases.length !== uniquePhraseIds.length) {
      throw ApiErrors.notFound("One or more phrases not found or do not match the selected difficulty");
    }
  } else {
    // Regular notebook: verify it exists and belongs to user
    const { data: notebook, error: notebookError } = await supabase
      .from("notebooks")
      .select("id, name")
      .eq("id", source_notebook_id)
      .eq("user_id", userId)
      .single();

    if (notebookError || !notebook) {
      throw ApiErrors.notFound("Source notebook not found");
    }

    sourceName = notebook.name;
    userNotebookIds = [source_notebook_id];

    // Verify all phrases exist and belong to this notebook
    const { data: existingPhrases, error: phrasesError } = await supabase
      .from("phrases")
      .select("id")
      .eq("notebook_id", source_notebook_id)
      .in("id", uniquePhraseIds);

    if (phrasesError) {
      // eslint-disable-next-line no-console
      console.error("Database error:", phrasesError);
      throw ApiErrors.internal("Failed to verify phrases");
    }

    if (!existingPhrases || existingPhrases.length !== uniquePhraseIds.length) {
      throw ApiErrors.notFound("One or more phrases not found in source notebook");
    }
  }

  // Fetch source phrases in the order provided (to preserve UI order)
  // We need to maintain the order from uniquePhraseIds array
  const { data: sourcePhrases, error: fetchError } = await supabase
    .from("phrases")
    .select("id, en_text, pl_text, tokens")
    .in("id", uniquePhraseIds);

  if (fetchError) {
    // eslint-disable-next-line no-console
    console.error("Database error:", fetchError);
    throw ApiErrors.internal("Failed to fetch source phrases");
  }

  if (!sourcePhrases || sourcePhrases.length !== uniquePhraseIds.length) {
    throw ApiErrors.notFound("Failed to fetch all source phrases");
  }

  // Create a map for quick lookup
  const phraseMap = new Map(sourcePhrases.map((p) => [p.id, p]));

  // Reorder phrases according to uniquePhraseIds order
  const orderedPhrases = uniquePhraseIds.map((id) => {
    const phrase = phraseMap.get(id);
    if (!phrase) {
      throw ApiErrors.notFound(`Phrase ${id} not found`);
    }
    return phrase;
  });

  // Generate snapshot name: [Snap_YYMMDD] <Źródło>
  const now = new Date();
  const year = now.getUTCFullYear().toString().slice(-2);
  const month = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = now.getUTCDate().toString().padStart(2, "0");
  const snapshotName = `[Snap_${year}${month}${day}] ${sourceName}`;

  // Check if notebook name already exists (unique per user)
  const { data: existingNotebook, error: checkError } = await supabase
    .from("notebooks")
    .select("id")
    .eq("user_id", userId)
    .eq("name", snapshotName)
    .maybeSingle();

  if (checkError && checkError.code !== "PGRST116") {
    // eslint-disable-next-line no-console
    console.error("Database error:", checkError);
    throw ApiErrors.internal("Failed to check notebook name");
  }

  if (existingNotebook) {
    throw ApiErrors.conflict("Notebook name already exists, please rename and try again.");
  }

  // Create new notebook
  const newNotebookId = randomUUID();
  const { data: newNotebook, error: notebookCreateError } = await supabase
    .from("notebooks")
    .insert({
      id: newNotebookId,
      user_id: userId,
      name: snapshotName,
    })
    .select("id, name, current_build_id, last_generate_job_id, created_at, updated_at")
    .single();

  if (notebookCreateError) {
    if (notebookCreateError.code === "23505") {
      // Unique violation - name conflict (race condition)
      throw ApiErrors.conflict("Notebook name already exists, please rename and try again.");
    }
    // eslint-disable-next-line no-console
    console.error("Database error:", notebookCreateError);
    throw ApiErrors.internal("Failed to create notebook");
  }

  // Generate positions (10, 20, 30, ...)
  const positions = generatePositions(orderedPhrases.length);

  // Create new phrases (copy en_text, pl_text, and tokens, set difficulty to null)
  const newPhrases = orderedPhrases.map((phrase, index) => ({
    id: randomUUID(),
    notebook_id: newNotebookId,
    position: positions[index],
    en_text: phrase.en_text,
    pl_text: phrase.pl_text,
    difficulty: null,
    tokens: phrase.tokens || null, // Copy tokens from source if they exist
  }));

  const { error: phrasesCreateError } = await supabase.from("phrases").insert(newPhrases);

  if (phrasesCreateError) {
    // eslint-disable-next-line no-console
    console.error("Database error:", phrasesCreateError);
    throw ApiErrors.internal("Failed to create phrases");
  }

  const response: CreateSnapshotResultDTO = {
    id: newNotebook.id,
    name: newNotebook.name,
    created_at: newNotebook.created_at,
    updated_at: newNotebook.updated_at,
  };

  return new Response(JSON.stringify(response), {
    status: 201,
    headers: {
      "Content-Type": "application/json",
    },
  });
};

export const POST: APIRoute = withErrorHandling(createSnapshot);
