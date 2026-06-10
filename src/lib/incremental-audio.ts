/* eslint-disable no-console */
import type { APIContext } from "astro";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "../db/database.types";
import { cleanMarkdownForTts, getSupabaseEnvVars } from "./utils";
import { setRuntimeEnv } from "./tts-encryption";

type ServiceSupabase = ReturnType<typeof createClient<Database>>;

// Minimal Buffer compatibility layer for environments without Node Buffer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BufferCompat: any =
  typeof Buffer !== "undefined"
    ? Buffer
    : {
        from(input: string | ArrayBuffer | Uint8Array | ArrayLike<number>, encoding?: string) {
          if (typeof input === "string") {
            if (encoding === "base64") {
              const binary = atob(input);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
              }
              return bytes;
            }
            const encoder = new TextEncoder();
            return encoder.encode(input);
          }

          if (input instanceof ArrayBuffer) {
            return new Uint8Array(input);
          }

          if (input instanceof Uint8Array) {
            return input;
          }

          return new Uint8Array(input as ArrayLike<number>);
        },
      };

class TtsService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async synthesize(text: string, voiceId: string, language: string): Promise<Uint8Array> {
    const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      headers: {
        "X-goog-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: language,
          name: voiceId,
        },
        audioConfig: {
          audioEncoding: "MP3",
          sampleRateHertz: 22050,
          speakingRate: 1.0,
        },
      }),
    });

    if (!response.ok) {
      if (response.status === 400) {
        throw new Error("invalid_key");
      }
      if (response.status === 402) {
        throw new Error("quota_exceeded");
      }
      if (response.status === 504) {
        throw new Error("tts_timeout");
      }
      throw new Error("tts_error");
    }

    const data = await response.json();
    return BufferCompat.from(data.audioContent, "base64");
  }
}

interface TriggerParams {
  context: APIContext;
  userId: string;
  notebookId: string;
  phraseIds: string[];
  source: "create_phrase" | "append_import";
}

type VoiceRow = Database["public"]["Tables"]["user_voices"]["Row"];
type PhraseRow = Pick<Database["public"]["Tables"]["phrases"]["Row"], "id" | "en_text" | "pl_text">;

export function triggerIncrementalAudioGeneration(params: TriggerParams): void {
  void runIncrementalAudioGeneration(params).catch((error) => {
    console.error("[incremental-audio] Background generation failed:", error);
  });
}

export async function runIncrementalAudioGeneration({
  context,
  userId,
  notebookId,
  phraseIds,
  source,
}: TriggerParams): Promise<void> {
  const uniquePhraseIds = Array.from(new Set(phraseIds.filter(Boolean)));
  if (uniquePhraseIds.length === 0) {
    return;
  }

  const localsAny = context.locals as unknown as {
    runtime?: { env?: Record<string, string | undefined> };
  };
  if (localsAny.runtime?.env) {
    setRuntimeEnv(localsAny.runtime.env);
  }

  const { supabaseUrl, supabaseServiceKey } = getSupabaseEnvVars(context);
  if (!supabaseUrl || !supabaseServiceKey) {
    console.warn("[incremental-audio] Missing Supabase service role config, skipping");
    return;
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: notebook, error: notebookError } = await supabase
    .from("notebooks")
    .select("id, current_build_id")
    .eq("id", notebookId)
    .eq("user_id", userId)
    .single();

  if (notebookError || !notebook) {
    console.warn("[incremental-audio] Notebook not found, skipping", { notebookId, source });
    return;
  }

  if (!notebook.current_build_id) {
    console.info("[incremental-audio] Notebook has no active build, skipping", { notebookId, source });
    return;
  }

  const { data: activeJobs, error: activeJobsError } = await supabase
    .from("jobs")
    .select("id, type, state")
    .eq("notebook_id", notebookId)
    .in("state", ["queued", "running"])
    .limit(1);

  if (activeJobsError) {
    console.warn("[incremental-audio] Failed to check active jobs, skipping", activeJobsError);
    return;
  }

  if (activeJobs && activeJobs.length > 0) {
    console.info("[incremental-audio] Active rebuild job detected, skipping", {
      notebookId,
      activeJobId: activeJobs[0].id,
      source,
    });
    return;
  }

  const { data: credentials, error: credentialsError } = await supabase
    .from("tts_credentials")
    .select("encrypted_key, is_configured")
    .eq("user_id", userId)
    .single();

  if (credentialsError || !credentials?.is_configured) {
    console.info("[incremental-audio] TTS not configured, skipping", { userId, notebookId, source });
    return;
  }

  const { data: voices, error: voicesError } = await supabase
    .from("user_voices")
    .select("slot, language, voice_id")
    .eq("user_id", userId)
    .order("slot");

  if (voicesError || !voices || voices.length === 0) {
    console.info("[incremental-audio] Voices not configured, skipping", { userId, notebookId, source });
    return;
  }

  const hasEn = voices.some((voice) => ["EN1", "EN2", "EN3"].includes(voice.slot) && Boolean(voice.voice_id));
  const hasPl = voices.some((voice) => voice.slot === "PL" && Boolean(voice.voice_id));
  if (!hasEn || !hasPl) {
    console.info("[incremental-audio] Voice configuration incomplete, skipping", { userId, notebookId, source });
    return;
  }

  const { data: phrases, error: phrasesError } = await supabase
    .from("phrases")
    .select("id, en_text, pl_text")
    .eq("notebook_id", notebookId)
    .in("id", uniquePhraseIds)
    .order("position");

  if (phrasesError || !phrases || phrases.length === 0) {
    console.warn("[incremental-audio] No matching new phrases found, skipping", { notebookId, source, phrasesError });
    return;
  }

  const { data: existingSegments, error: existingSegmentsError } = await supabase
    .from("audio_segments")
    .select("phrase_id, voice_slot")
    .eq("build_id", notebook.current_build_id)
    .in(
      "phrase_id",
      phrases.map((phrase) => phrase.id)
    );

  if (existingSegmentsError) {
    console.warn("[incremental-audio] Failed to check existing segments, skipping", existingSegmentsError);
    return;
  }

  const existingSlotsByPhrase = new Map<string, Set<string>>();
  for (const segment of existingSegments || []) {
    const slots = existingSlotsByPhrase.get(segment.phrase_id) ?? new Set<string>();
    slots.add(segment.voice_slot);
    existingSlotsByPhrase.set(segment.phrase_id, slots);
  }

  const { decrypt } = await import("./tts-encryption");
  const apiKey = await decrypt(credentials.encrypted_key);
  const ttsService = new TtsService(apiKey);

  const pendingSegments = await generateSegmentsForPhrases({
    supabase,
    ttsService,
    userId,
    notebookId,
    buildId: notebook.current_build_id,
    phrases: phrases as PhraseRow[],
    voices: voices as VoiceRow[],
    existingSlotsByPhrase,
  });

  if (pendingSegments.length === 0) {
    console.info("[incremental-audio] Nothing new to insert", { notebookId, source, phrases: phrases.length });
    return;
  }

  const { error: insertError } = await supabase.from("audio_segments").insert(pendingSegments);
  if (insertError) {
    console.error("[incremental-audio] Failed to insert generated segments", insertError);
    return;
  }

  console.info("[incremental-audio] Inserted incremental audio segments", {
    notebookId,
    source,
    phraseCount: phrases.length,
    segmentCount: pendingSegments.length,
  });
}

async function generateSegmentsForPhrases({
  supabase,
  ttsService,
  userId,
  notebookId,
  buildId,
  phrases,
  voices,
  existingSlotsByPhrase,
}: {
  supabase: ServiceSupabase;
  ttsService: TtsService;
  userId: string;
  notebookId: string;
  buildId: string;
  phrases: PhraseRow[];
  voices: VoiceRow[];
  existingSlotsByPhrase: Map<string, Set<string>>;
}): Promise<Database["public"]["Tables"]["audio_segments"]["Insert"][]> {
  const audioSegments: Database["public"]["Tables"]["audio_segments"]["Insert"][] = [];

  for (const phrase of phrases) {
    const existingSlots = existingSlotsByPhrase.get(phrase.id) ?? new Set<string>();

    for (const voice of voices) {
      if (existingSlots.has(voice.slot)) {
        continue;
      }

      try {
        const rawText = voice.language === "en" ? phrase.en_text : phrase.pl_text;
        if (!rawText || rawText.trim() === "") {
          continue;
        }

        const text = cleanMarkdownForTts(rawText);
        const audioBuffer = await ttsService.synthesize(text, voice.voice_id, voice.language);
        const storagePath = `${userId}/${notebookId}/${phrase.id}`;
        const fileName = `${storagePath}/${voice.slot}.mp3`;

        const { error: uploadError } = await supabase.storage.from("audio").upload(fileName, audioBuffer, {
          contentType: "audio/mpeg",
          cacheControl: "3600",
          upsert: true,
        });

        if (uploadError) {
          audioSegments.push({
            id: randomUUID(),
            phrase_id: phrase.id,
            build_id: buildId,
            voice_slot: voice.slot,
            status: "failed",
            error_code: "upload_failed",
            path: `failed/${userId}/${notebookId}/${phrase.id}/${voice.slot}.mp3`,
            size_bytes: null,
            duration_ms: null,
            sample_rate_hz: 22050,
            bitrate_kbps: 64,
            is_active: true,
          });
          continue;
        }

        audioSegments.push({
          id: randomUUID(),
          phrase_id: phrase.id,
          build_id: buildId,
          voice_slot: voice.slot,
          status: "complete",
          error_code: null,
          path: fileName,
          size_bytes: audioBuffer.length,
          duration_ms: null,
          sample_rate_hz: 22050,
          bitrate_kbps: 64,
          is_active: true,
        });
      } catch (error) {
        const errorCode = error instanceof Error ? error.message : "unknown_error";
        audioSegments.push({
          id: randomUUID(),
          phrase_id: phrase.id,
          build_id: buildId,
          voice_slot: voice.slot,
          status: "failed",
          error_code: errorCode,
          path: `failed/${userId}/${notebookId}/${phrase.id}/${voice.slot}.mp3`,
          size_bytes: null,
          duration_ms: null,
          sample_rate_hz: 22050,
          bitrate_kbps: 64,
          is_active: true,
        });
      }
    }
  }

  return audioSegments;
}
