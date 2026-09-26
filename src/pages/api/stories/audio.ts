/* eslint-disable no-console */
import { randomUUID } from "node:crypto";
import type { APIRoute, APIContext } from "astro";
import { z } from "zod";
import type { LocalsWithAuth } from "../../../lib/types";
import { ApiErrors, requireAuth, withErrorHandling } from "../../../lib/errors";
import {
  DEFAULT_STORY_TTS_VOICE,
  getStoryNarrationText,
  STORY_AUDIO_CACHE_TTL_MS,
  STORY_TTS_VOICES,
} from "../../../lib/story-settings";
import { decrypt, setRuntimeEnv } from "../../../lib/tts-encryption";
import { cleanMarkdownForTts, getSupabaseClient } from "../../../lib/utils";

export const prerender = false;

const StoryAudioSchema = z.object({
  content: z.string().trim().min(1, "Story content is required").max(20_000),
});

function configureRuntimeEnv(context: APIContext) {
  const locals = context.locals as unknown as { runtime?: { env?: Record<string, string | undefined> } };
  if (locals.runtime?.env) setRuntimeEnv(locals.runtime.env);
}

async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function createSignedUrl(db: ReturnType<typeof getSupabaseClient>, path: string): Promise<string> {
  const { data, error } = await db.storage.from("audio").createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw ApiErrors.internal("Could not prepare story audio");
  return data.signedUrl;
}

export const POST: APIRoute = withErrorHandling(async (context: APIContext) => {
  configureRuntimeEnv(context);
  const userId = (context.locals as LocalsWithAuth).userId;
  requireAuth(userId);
  const parsed = StoryAudioSchema.safeParse(await context.request.json());
  if (!parsed.success) throw ApiErrors.validationError("Invalid story audio request", parsed.error.flatten());

  // Stories have an English and a Polish-English section. A British voice reads
  // the English section only; custom prompts without that heading use all text.
  const narrationText = cleanMarkdownForTts(getStoryNarrationText(parsed.data.content));
  if (!narrationText) throw ApiErrors.validationError("The English story has no readable text");
  if (new TextEncoder().encode(narrationText).byteLength > 5_000) {
    throw ApiErrors.limitExceeded("The English story is too long to narrate in one request");
  }

  const db = getSupabaseClient(context);
  const { data: settings, error: settingsError } = await db
    .from("story_settings")
    .select("tts_voice_id")
    .eq("user_id", userId)
    .single();
  if (settingsError || !settings) throw ApiErrors.validationError("Configure story settings before playing audio");
  const voiceId = settings.tts_voice_id || DEFAULT_STORY_TTS_VOICE;
  if (!STORY_TTS_VOICES.some((voice) => voice.id === voiceId)) {
    throw ApiErrors.validationError("Choose a supported British Chirp 3: HD voice in Settings");
  }

  const contentHash = await sha256(narrationText);
  const now = new Date();
  const { data: cached, error: cacheError } = await db
    .from("story_audio_cache")
    .select("id, path, expires_at")
    .eq("user_id", userId)
    .eq("content_hash", contentHash)
    .eq("voice_id", voiceId)
    .maybeSingle();
  if (cacheError) throw ApiErrors.internal("Could not check the story audio cache");
  if (cached && new Date(cached.expires_at) > now) {
    return Response.json({ url: await createSignedUrl(db, cached.path), cached: true, expires_at: cached.expires_at });
  }

  const { data: credentials, error: credentialsError } = await db
    .from("tts_credentials")
    .select("encrypted_key, is_configured")
    .eq("user_id", userId)
    .single();
  if (credentialsError || !credentials?.is_configured) {
    throw ApiErrors.validationError("Configure Google TTS credentials before playing story audio");
  }

  let apiKey: string;
  try {
    apiKey = await decrypt(credentials.encrypted_key);
  } catch (error) {
    console.error("Failed to decrypt Google TTS key for story audio", error);
    throw ApiErrors.internal("Could not read Google TTS credentials. Save the key again in Settings.");
  }

  const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: { "X-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text: narrationText },
      voice: { languageCode: "en-GB", name: voiceId },
      // Chirp 3: HD doesn't support SSML, speakingRate, or pitch.
      audioConfig: { audioEncoding: "MP3" },
    }),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw ApiErrors.invalidKey("Google TTS key is invalid");
    if (response.status === 429) throw ApiErrors.quotaExceeded("Google TTS quota has been exceeded");
    if (response.status === 504) throw ApiErrors.ttsTimeout("Google TTS timed out");
    console.error("Story TTS failed", response.status, await response.text());
    throw ApiErrors.internal("Could not create story audio");
  }

  const payload = (await response.json()) as { audioContent?: string };
  if (!payload.audioContent) throw ApiErrors.internal("Google TTS returned no audio");
  const audioBytes = Uint8Array.from(atob(payload.audioContent), (character) => character.charCodeAt(0));
  const path = `${userId}/stories/${contentHash}-${voiceId}.mp3`;
  const { error: uploadError } = await db.storage.from("audio").upload(path, audioBytes, {
    contentType: "audio/mpeg",
    cacheControl: "3600",
    upsert: true,
  });
  if (uploadError) {
    console.error("Failed to cache story audio", uploadError);
    throw ApiErrors.internal("Could not save story audio");
  }

  const expiresAt = new Date(now.getTime() + STORY_AUDIO_CACHE_TTL_MS).toISOString();
  const { error: saveCacheError } = await db.from("story_audio_cache").upsert({
    id: cached?.id ?? randomUUID(),
    user_id: userId,
    content_hash: contentHash,
    voice_id: voiceId,
    path,
    expires_at: expiresAt,
    updated_at: now.toISOString(),
  });
  if (saveCacheError) {
    console.error("Failed to store story audio cache metadata", saveCacheError);
    throw ApiErrors.internal("Could not save story audio cache");
  }

  return Response.json({ url: await createSignedUrl(db, path), cached: false, expires_at: expiresAt });
});
