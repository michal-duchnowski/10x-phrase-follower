import type { APIRoute } from "astro";
import { randomUUID } from "node:crypto";
import type { ImportNotebookCommand, ImportNotebookResultDTO } from "../../../types";
import { withErrorHandling, ApiErrors } from "../../../lib/errors";
import {
  validateIdempotencyKey,
  getIdempotencyResponse,
  storeIdempotencyResponse,
} from "../../../lib/idempotency.service";
import {
  validateImportCommand,
  processImportLines,
  generatePositions,
  createBasicTokens,
} from "../../../lib/import.service";
import type { Json } from "../../../db/database.types";
import { ensureUserExists, getSupabaseClient } from "../../../lib/utils";

export const prerender = false;

export const POST: APIRoute = withErrorHandling(async ({ locals, request }) => {
  // Check for idempotency key
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !validateIdempotencyKey(idempotencyKey)) {
    throw ApiErrors.validationError("Valid Idempotency-Key header is required (UUID format)");
  }

  // Get user from locals (set by middleware)
  const userId = locals.userId as string;
  if (!userId) {
    throw ApiErrors.unauthorized();
  }

  // Check for existing idempotent response
  const existingResponse = getIdempotencyResponse(userId, "import", idempotencyKey);
  if (existingResponse) {
    return new Response(JSON.stringify(existingResponse), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse and validate request
  const command: ImportNotebookCommand = await request.json();
  validateImportCommand(command);

  const { notebook_id: existingNotebookId, name, lines, normalize = false } = command;

  // Get authenticated Supabase client
  const context = { locals, request } as Parameters<typeof getSupabaseClient>[0];
  const supabase = getSupabaseClient(context);

  // Ensure user exists in the users table before creating notebook
  // This is needed because users are created in auth.users by Supabase Auth,
  // but we need a corresponding row in the public.users table for foreign key constraints
  await ensureUserExists(supabase, userId);

  const isAppending = Boolean(existingNotebookId);
  let notebookId: string;
  let notebook: ImportNotebookResultDTO["notebook"];

  // Process import lines
  const importResult = processImportLines(lines, normalize);
  const { accepted, rejected } = importResult;

  if (accepted.length === 0) {
    throw ApiErrors.validationError("No valid phrases found in import");
  }

  if (isAppending) {
    notebookId = existingNotebookId as string;

    const { data: existingNotebook, error: existingNotebookError } = await supabase
      .from("notebooks")
      .select("id, name, current_build_id, last_generate_job_id, created_at, updated_at")
      .eq("id", notebookId)
      .eq("user_id", userId)
      .single();

    if (existingNotebookError) {
      throw ApiErrors.notFound("Notebook not found");
    }

    notebook = existingNotebook;
  } else {
    // Check notebook limit (500 per user) only when creating a new notebook
    const { count: notebookCount, error: countError } = await supabase
      .from("notebooks")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (countError) {
      throw ApiErrors.internal("Failed to check notebook limit", countError);
    }

    if (notebookCount && notebookCount >= 500) {
      throw ApiErrors.limitExceeded("Maximum 500 notebooks per user exceeded");
    }

    // Create notebook
    notebookId = randomUUID();
    const { data: createdNotebook, error: notebookError } = await supabase
      .from("notebooks")
      .insert({
        id: notebookId,
        user_id: userId,
        name: name.trim(),
      })
      .select("id, name, current_build_id, last_generate_job_id, created_at, updated_at")
      .single();

    if (notebookError) {
      if (notebookError.code === "23505") {
        throw ApiErrors.uniqueViolation("Notebook name already exists");
      }
      throw ApiErrors.internal("Failed to create notebook", notebookError);
    }

    notebook = createdNotebook;
  }

  // Create phrases with positions
  let basePosition = 0;
  if (isAppending) {
    const { data: maxRow, error: maxError } = await supabase
      .from("phrases")
      .select("position")
      .eq("notebook_id", notebookId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (maxError) {
      throw ApiErrors.internal("Failed to determine phrase position", maxError);
    }

    basePosition = maxRow?.position ?? 0;
  }

  const positions = generatePositions(accepted.length).map((p) => p + basePosition);
  const phrases = accepted.map((line, index) => ({
    id: randomUUID(),
    notebook_id: notebookId,
    position: positions[index],
    en_text: line.en,
    pl_text: line.pl,
    tokens: createBasicTokens(line.en, line.pl) as unknown as Json, // Cast to Json for DB compatibility
  }));

  const { error: phrasesError } = await supabase.from("phrases").insert(phrases);

  if (phrasesError) {
    throw ApiErrors.internal("Failed to create phrases", phrasesError);
  }

  // Create import logs for rejected lines
  if (rejected.length > 0) {
    const importLogs = rejected.map((reject) => ({
      id: randomUUID(),
      user_id: userId,
      notebook_id: notebookId,
      line_no: reject.lineNo,
      raw_text: reject.rawText,
      reason: reject.reason,
    }));

    const { error: logsError } = await supabase.from("import_logs").insert(importLogs);
    if (logsError) {
      // Log error but don't fail the import
      // eslint-disable-next-line no-console
      console.error("Failed to create import logs:", logsError);
    }
  }

  // Prepare response
  const response: ImportNotebookResultDTO = {
    notebook,
    import: {
      accepted: accepted.length,
      rejected: rejected.length,
      logs: rejected.map((reject) => ({
        id: randomUUID(),
        line_no: reject.lineNo,
        raw_text: reject.rawText,
        reason: reject.reason,
        created_at: new Date().toISOString(),
      })),
    },
  };

  // Store idempotent response
  storeIdempotencyResponse(userId, "import", idempotencyKey, response);

  return new Response(JSON.stringify(response), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
});
