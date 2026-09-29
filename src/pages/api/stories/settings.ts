import type { APIRoute, APIContext } from "astro";
import { z } from "zod";
import { ApiErrors, requireAuth, withErrorHandling } from "../../../lib/errors";
import {
  DEFAULT_STORY_MODEL,
  DEFAULT_STORY_MAX_TOKENS,
  DEFAULT_STORY_PROMPT,
  DEFAULT_STORY_TEMPERATURE,
  DEFAULT_STORY_THINKING_ENABLED,
  DEFAULT_STORY_THINKING_EFFORT,
  DEFAULT_STORY_TTS_SPEAKING_RATE,
  DEFAULT_STORY_TTS_VOICE,
  STORY_THINKING_EFFORTS,
  STORY_TTS_VOICES,
} from "../../../lib/story-settings";
import { encrypt, setRuntimeEnv } from "../../../lib/tts-encryption";
import { ensureUserExists, getSupabaseClient } from "../../../lib/utils";

export const prerender = false;

const StorySettingsSchema = z.object({
  api_key: z.string().trim().min(1, "API key cannot be empty").max(1000).optional(),
  model: z.string().trim().min(1, "Model is required").max(200),
  prompt: z.string().trim().min(1, "Prompt is required").max(12000),
  temperature: z.number().min(0).max(2),
  max_tokens: z.number().int().min(100).max(64_000),
  thinking_enabled: z.boolean(),
  thinking_effort: z.enum(STORY_THINKING_EFFORTS),
  tts_voice_id: z.string().refine((voiceId) => STORY_TTS_VOICES.some((voice) => voice.id === voiceId), {
    message: "Choose a supported British Chirp 3: HD voice",
  }),
  tts_speaking_rate: z.number().min(0.25).max(2),
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
    .select(
      "encrypted_api_key, model, prompt, temperature, max_tokens, thinking_enabled, thinking_effort, tts_voice_id, tts_speaking_rate"
    )
    .eq("user_id", userId)
    .single();
  if (error || !data) throw ApiErrors.internal("Failed to load story settings");

  return Response.json({
    is_configured: Boolean(data.encrypted_api_key),
    model: data.model || DEFAULT_STORY_MODEL,
    prompt: data.prompt || DEFAULT_STORY_PROMPT,
    temperature: data.temperature ?? DEFAULT_STORY_TEMPERATURE,
    max_tokens: data.max_tokens ?? DEFAULT_STORY_MAX_TOKENS,
    thinking_enabled: data.thinking_enabled ?? DEFAULT_STORY_THINKING_ENABLED,
    thinking_effort: data.thinking_effort ?? DEFAULT_STORY_THINKING_EFFORT,
    tts_voice_id: data.tts_voice_id || DEFAULT_STORY_TTS_VOICE,
    tts_speaking_rate: data.tts_speaking_rate || DEFAULT_STORY_TTS_SPEAKING_RATE,
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

  const update: {
    model: string;
    prompt: string;
    temperature: number;
    max_tokens: number;
    thinking_enabled: boolean;
    thinking_effort: "low" | "high" | "max";
    tts_speaking_rate: number;
    tts_voice_id: string;
    updated_at: string;
    encrypted_api_key?: string;
  } = {
    model: body.model,
    prompt: body.prompt,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    thinking_enabled: body.thinking_enabled,
    thinking_effort: body.thinking_effort,
    tts_speaking_rate: body.tts_speaking_rate,
    tts_voice_id: body.tts_voice_id,
    updated_at: new Date().toISOString(),
  };
  if (body.api_key) update.encrypted_api_key = await toBase64(body.api_key);

  const { data, error } = await db
    .from("story_settings")
    .update(update)
    .eq("user_id", userId)
    .select(
      "encrypted_api_key, model, prompt, temperature, max_tokens, thinking_enabled, thinking_effort, tts_voice_id, tts_speaking_rate"
    )
    .single();
  if (error || !data) throw ApiErrors.internal("Failed to save story settings");

  return Response.json({
    is_configured: Boolean(data.encrypted_api_key),
    model: data.model,
    prompt: data.prompt,
    temperature: data.temperature,
    max_tokens: data.max_tokens,
    thinking_enabled: data.thinking_enabled,
    thinking_effort: data.thinking_effort,
    tts_voice_id: data.tts_voice_id,
    tts_speaking_rate: data.tts_speaking_rate,
  });
});
