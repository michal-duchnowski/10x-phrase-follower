/* eslint-disable no-console */
import type { APIContext, APIRoute } from "astro";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { z } from "zod";
import type { LocalsWithAuth } from "../../../../lib/types";
import { ApiErrors, requireAuth, withErrorHandling } from "../../../../lib/errors";
import {
  DEFAULT_STORY_TTS_SPEAKING_RATE,
  DEFAULT_STORY_TTS_VOICE,
  getStoryNarrationText,
  STORY_TTS_VOICES,
} from "../../../../lib/story-settings";
import {
  encodeLiveAudioFrame,
  LIVE_AUDIO_CONTENT_TYPE,
  LIVE_AUDIO_FRAME,
  splitTextForStreaming,
} from "../../../../lib/story-live-audio";
import { decrypt, setRuntimeEnv } from "../../../../lib/tts-encryption";
import { cleanMarkdownForTts, getSupabaseClient } from "../../../../lib/utils";

export const prerender = false;

const StoryAudioSchema = z.object({
  content: z.string().trim().min(1, "Story content is required").max(20_000),
});

const GRPC_STATUS_NAMES: Record<number, string> = {
  3: "INVALID_ARGUMENT",
  4: "DEADLINE_EXCEEDED",
  7: "PERMISSION_DENIED",
  8: "RESOURCE_EXHAUSTED",
  12: "UNIMPLEMENTED",
  14: "UNAVAILABLE",
  16: "UNAUTHENTICATED",
};

interface GrpcErrorLike {
  code?: number;
}

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

function safeStreamingError(error: unknown): { code: string; message: string } {
  const status = typeof error === "object" && error ? (error as GrpcErrorLike).code : undefined;
  const code = typeof status === "number" ? (GRPC_STATUS_NAMES[status] ?? `GRPC_${status}`) : "STREAM_FAILED";
  const messages: Record<string, string> = {
    INVALID_ARGUMENT: "Google rejected the streaming audio configuration.",
    DEADLINE_EXCEEDED: "Google TTS streaming timed out.",
    PERMISSION_DENIED: "The configured API key is not authorized for StreamingSynthesize.",
    RESOURCE_EXHAUSTED: "Google TTS streaming quota has been exceeded.",
    UNIMPLEMENTED: "StreamingSynthesize is not available for this Google TTS configuration.",
    UNAVAILABLE: "Google TTS streaming is temporarily unavailable.",
    UNAUTHENTICATED: "Google rejected the configured TTS credentials.",
  };
  return { code, message: messages[code] ?? "Google TTS streaming failed." };
}

export const POST: APIRoute = withErrorHandling(async (context: APIContext) => {
  configureRuntimeEnv(context);
  const userId = (context.locals as LocalsWithAuth).userId;
  requireAuth(userId);
  const parsed = StoryAudioSchema.safeParse(await context.request.json());
  if (!parsed.success) throw ApiErrors.validationError("Invalid story audio request", parsed.error.flatten());

  const narrationText = cleanMarkdownForTts(getStoryNarrationText(parsed.data.content));
  if (!narrationText) throw ApiErrors.validationError("The English story has no readable text");
  if (new TextEncoder().encode(narrationText).byteLength > 5_000) {
    throw ApiErrors.limitExceeded("The English story is too long to narrate in one request");
  }

  const db = getSupabaseClient(context);
  const { data: settings, error: settingsError } = await db
    .from("story_settings")
    .select("tts_voice_id, tts_speaking_rate")
    .eq("user_id", userId)
    .single();
  if (settingsError || !settings) throw ApiErrors.validationError("Configure story settings before playing audio");

  const voiceId = settings.tts_voice_id || DEFAULT_STORY_TTS_VOICE;
  const speakingRate = settings.tts_speaking_rate || DEFAULT_STORY_TTS_SPEAKING_RATE;
  if (!STORY_TTS_VOICES.some((voice) => voice.id === voiceId)) {
    throw ApiErrors.validationError("Choose a supported British Chirp 3: HD voice in Settings");
  }

  const contentHash = await sha256(JSON.stringify({ narrationText, speakingRate }));
  const { data: cached, error: cacheError } = await db
    .from("story_audio_cache")
    .select("path, expires_at")
    .eq("user_id", userId)
    .eq("content_hash", contentHash)
    .eq("voice_id", voiceId)
    .maybeSingle();
  if (cacheError) throw ApiErrors.internal("Could not check the story audio cache");
  if (cached && new Date(cached.expires_at) > new Date()) {
    const { data: signed, error: signedUrlError } = await db.storage.from("audio").createSignedUrl(cached.path, 3600);
    if (signedUrlError || !signed?.signedUrl) throw ApiErrors.internal("Could not prepare story audio");
    return Response.json({ mode: "cached", url: signed.signedUrl });
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
  } catch {
    throw ApiErrors.internal("Could not read Google TTS credentials. Save the key again in Settings.");
  }

  let rpcStream: ReturnType<TextToSpeechClient["streamingSynthesize"]> | null = null;
  let client: TextToSpeechClient | null = null;
  let stopped = false;
  let removeAbortListener: () => void = () => undefined;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    removeAbortListener();
    rpcStream?.cancel();
    if (client) void client.close().catch(() => undefined);
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (frame: Uint8Array) => {
        if (!stopped) controller.enqueue(frame);
      };
      const close = () => {
        if (stopped) return;
        enqueue(encodeLiveAudioFrame(LIVE_AUDIO_FRAME.end));
        controller.close();
        cleanup();
      };
      const fail = (error: unknown) => {
        if (stopped) return;
        const safeError = safeStreamingError(error);
        console.error("Story live TTS failed", safeError.code);
        enqueue(encodeLiveAudioFrame(LIVE_AUDIO_FRAME.error, new TextEncoder().encode(JSON.stringify(safeError))));
        controller.close();
        cleanup();
      };
      const abort = () => cleanup();
      context.request.signal.addEventListener("abort", abort, { once: true });
      removeAbortListener = () => context.request.signal.removeEventListener("abort", abort);

      try {
        client = new TextToSpeechClient({ apiKey });
        rpcStream = client.streamingSynthesize();
        rpcStream.on("data", (response: { audioContent?: Uint8Array | string | null }) => {
          if (!response.audioContent) return;
          const audio =
            typeof response.audioContent === "string"
              ? Uint8Array.from(Buffer.from(response.audioContent, "base64"))
              : Uint8Array.from(response.audioContent);
          enqueue(encodeLiveAudioFrame(LIVE_AUDIO_FRAME.audio, audio));
        });
        rpcStream.on("error", fail);
        rpcStream.on("end", close);
        rpcStream.write({
          streamingConfig: {
            voice: { languageCode: "en-GB", name: voiceId },
            streamingAudioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24_000, speakingRate },
          },
        });
        for (const text of splitTextForStreaming(narrationText)) rpcStream.write({ input: { text } });
        rpcStream.end();
      } catch (error) {
        fail(error);
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": LIVE_AUDIO_CONTENT_TYPE,
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
