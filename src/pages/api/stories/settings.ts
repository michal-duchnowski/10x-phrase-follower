import type { APIRoute, APIContext } from "astro";
import { z } from "zod";
import { ApiErrors, requireAuth, withErrorHandling } from "../../../lib/errors";
import { DEFAULT_STORY_MODEL, DEFAULT_STORY_PROMPT } from "../../../lib/story-settings";
import { encrypt, setRuntimeEnv } from "../../../lib/tts-encryption";
import { ensureUserExists, getSupabaseClient } from "../../../lib/utils";

export const prerender = false;

const StorySettingsSchema = z.object({
  api_key: z.string().trim().min(1, "API key cannot be empty").max(1000).optional(),
  model: z.string().trim().min(1, "Model is required").max(200),
  prompt: z.string().trim().min(1, "Prompt is required").max(12000),
});

function configureRuntimeEnv(context: APIContext) {
  const locals = context.locals as unknown as { runtime?: { env?: Record<string, string | undefined> } };
  if (locals.runtime?.env) setRuntimeEnv(locals.runtime.env);
}

async function toBase64(value: string): Promise<string> {
  const encrypted = await encrypt(value);
  return Buffer.from(encrypted).toString("base64");
}

export const GET: APIRoute = withErrorHandling(async (context: APIContext) => {
  configureRuntimeEnv(context);
  const userId = context.locals.userId;
  requireAuth(userId);
  const db = getSupabaseClient(context);
  await ensureUserExists(db, userId);

  const { data, error } = await db
    .from("story_settings")
    .select("encrypted_api_key, model, prompt")
    .eq("user_id", userId)
    .single();
  if (error || !data) throw ApiErrors.internal("Failed to load story settings");

  return Response.json({
    is_configured: Boolean(data.encrypted_api_key),
    model: data.model || DEFAULT_STORY_MODEL,
    prompt: data.prompt || DEFAULT_STORY_PROMPT,
  });
});

export const PUT: APIRoute = withErrorHandling(async (context: APIContext) => {
  configureRuntimeEnv(context);
  const userId = context.locals.userId;
  requireAuth(userId);
  const db = getSupabaseClient(context);
  await ensureUserExists(db, userId);
  const parsedBody = StorySettingsSchema.safeParse(await context.request.json());
  if (!parsedBody.success) throw ApiErrors.validationError("Invalid story settings", parsedBody.error.flatten());
  const body = parsedBody.data;

  const update: { model: string; prompt: string; updated_at: string; encrypted_api_key?: string } = {
    model: body.model,
    prompt: body.prompt,
    updated_at: new Date().toISOString(),
  };
  if (body.api_key) update.encrypted_api_key = await toBase64(body.api_key);

  const { data, error } = await db
    .from("story_settings")
    .update(update)
    .eq("user_id", userId)
    .select("encrypted_api_key, model, prompt")
    .single();
  if (error || !data) throw ApiErrors.internal("Failed to save story settings");

  return Response.json({ is_configured: Boolean(data.encrypted_api_key), model: data.model, prompt: data.prompt });
});
