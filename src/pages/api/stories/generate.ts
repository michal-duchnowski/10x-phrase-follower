/* eslint-disable @typescript-eslint/no-explicit-any */
import type { APIRoute, APIContext } from "astro";
import type { LocalsWithAuth } from "../../../lib/types";
import { ApiErrors, requireAuth, withErrorHandling } from "../../../lib/errors";
import { STORY_PROMPT_SUFFIX } from "../../../lib/story-settings";
import { decrypt, setRuntimeEnv } from "../../../lib/tts-encryption";
import { getSupabaseClient } from "../../../lib/utils";

export const prerender = false;

const MAX_PHRASES = 20;
const MAX_PHRASE_LENGTH = 500;
const MAX_VOCABULARY_LENGTH = 6000;

export const POST: APIRoute = withErrorHandling(async (context: APIContext) => {
  const userId = (context.locals as LocalsWithAuth).userId;
  requireAuth(userId);

  const body = await context.request.json();
  const ids = body?.phrase_ids;
  if (!Array.isArray(ids) || ids.length < 3 || ids.length > MAX_PHRASES || ids.some((id) => typeof id !== "string")) {
    throw ApiErrors.validationError(`phrase_ids must contain from 3 to ${MAX_PHRASES} IDs`);
  }
  const phraseIds = [...new Set(ids)];
  if (phraseIds.length !== ids.length) throw ApiErrors.validationError("phrase_ids must not contain duplicates");

  const db: any = getSupabaseClient(context);
  const { data: phrases, error } = await db
    .from("phrases")
    .select("id, en_text, pl_text, notebooks!inner(user_id)")
    .in("id", phraseIds)
    .eq("notebooks.user_id", userId);
  if (error || !phrases || phrases.length !== phraseIds.length) {
    throw ApiErrors.validationError("One or more phrases are not accessible");
  }

  if (
    phrases.some(
      (phrase: any) => phrase.en_text.length > MAX_PHRASE_LENGTH || phrase.pl_text.length > MAX_PHRASE_LENGTH
    )
  ) {
    throw ApiErrors.validationError(`Each selected phrase must be at most ${MAX_PHRASE_LENGTH} characters long`);
  }

  const locals = context.locals as unknown as { runtime?: { env?: Record<string, string | undefined> } };
  if (locals.runtime?.env) setRuntimeEnv(locals.runtime.env);
  const { data: settings, error: settingsError } = await db
    .from("story_settings")
    .select("encrypted_api_key, model, prompt")
    .eq("user_id", userId)
    .single();
  if (settingsError || !settings)
    throw ApiErrors.validationError("Configure AI story settings before generating a story.");
  if (!settings.encrypted_api_key) {
    throw ApiErrors.validationError("Add your DeepSeek API key in Settings before generating a story.");
  }
  let apiKey: string;
  try {
    apiKey = await decrypt(settings.encrypted_api_key);
  } catch (error) {
    console.error("Failed to decrypt DeepSeek API key", error);
    throw ApiErrors.internal("Could not read your AI story credentials. Save the API key again in Settings.");
  }

  const orderedPhrases = phraseIds.map((id) => phrases.find((phrase: any) => phrase.id === id));
  const vocabulary = JSON.stringify(
    orderedPhrases.map((phrase: any) => ({ english: phrase.en_text, polishMeaning: phrase.pl_text }))
  );
  if (vocabulary.length > MAX_VOCABULARY_LENGTH) {
    throw ApiErrors.validationError("The selected phrases are too long to create one story");
  }
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.8,
      max_tokens: 500,
      thinking: { type: "disabled" },
      messages: [
        {
          role: "system",
          content: settings.prompt,
        },
        {
          role: "user",
          content: `${STORY_PROMPT_SUFFIX}\n\n<vocabulary-data>\n${vocabulary}\n</vocabulary-data>`,
        },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) {
    console.error("DeepSeek story generation failed", response.status, await response.text());
    throw ApiErrors.internal("Could not generate a story. Please try again.");
  }
  const result = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
  const content = result.choices?.[0]?.message?.content?.trim();
  if (!content) throw ApiErrors.internal("The story generator returned an empty response. Please try again.");
  let stories: { english_story?: unknown; polish_english_story?: unknown };
  try {
    stories = JSON.parse(content);
  } catch {
    throw ApiErrors.internal("The story generator returned an invalid response. Please try again.");
  }
  if (typeof stories.english_story !== "string" || typeof stories.polish_english_story !== "string") {
    throw ApiErrors.internal("The story generator returned an incomplete response. Please try again.");
  }
  return Response.json({
    english_story: stories.english_story.trim(),
    polish_english_story: stories.polish_english_story.trim(),
  });
});
