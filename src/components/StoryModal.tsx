import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Languages, LoaderCircle, RefreshCw, Square, Volume2, Waves, X } from "lucide-react";
import { parseMarkdownToHtml } from "../lib/utils";
import { useApi } from "../lib/hooks/useApi";
import { PcmStreamPlayer } from "../lib/pcm-stream-player";
import { createPcmWavBlob, getPcmDurationSeconds } from "../lib/pcm-wav";
import { LIVE_AUDIO_CONTENT_TYPE, LIVE_AUDIO_FRAME, LiveAudioFrameDecoder } from "../lib/story-live-audio";
import { storyLiveAudioCache } from "../lib/story-live-audio-cache";
import liveAudioKeepAliveUrl from "../assets/silence-800ms.mp3?url";
import { Button } from "./ui/button";

interface StoryModalProps {
  open: boolean;
  phraseIds: string[];
  onClose: () => void;
}
interface StoryContent {
  content: string;
}

interface TranslationResult {
  translation: string;
}

interface AudioSessionLike {
  type: string;
}

function getAudioSession(): AudioSessionLike | null {
  return (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession ?? null;
}

function isIosDevice(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function attachNativeMediaSession(audio: HTMLAudioElement, onStop: () => void): () => void {
  if (!("mediaSession" in navigator)) return () => undefined;
  const mediaSession = navigator.mediaSession;

  try {
    mediaSession.metadata = new MediaMetadata({
      title: "English story",
      artist: "10x Phrase Follower",
    });
  } catch {
    // Metadata is optional and older WebKit versions can reject it.
  }

  const safeSetAction = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
    try {
      mediaSession.setActionHandler(action, handler);
    } catch {
      // Ignore individual actions that this WebKit version does not support.
    }
  };
  const seekTo = (position: number, fastSeek = false) => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const nextPosition = Math.min(Math.max(0, position), audio.duration);
    if (fastSeek && typeof audio.fastSeek === "function") audio.fastSeek(nextPosition);
    else audio.currentTime = nextPosition;
  };
  const updatePositionState = () => {
    try {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(Math.max(0, audio.currentTime), audio.duration),
      });
    } catch {
      // Native audio still works when position state is unavailable.
    }
  };
  const updatePlayingState = () => {
    try {
      mediaSession.playbackState = "playing";
      updatePositionState();
    } catch {
      // Ignore partial Media Session implementations.
    }
  };
  const updatePausedState = () => {
    try {
      mediaSession.playbackState = audio.ended ? "none" : "paused";
      updatePositionState();
    } catch {
      // Ignore partial Media Session implementations.
    }
  };

  safeSetAction("play", () => void audio.play().catch(() => undefined));
  safeSetAction("pause", () => audio.pause());
  safeSetAction("stop", onStop);
  safeSetAction("seekto", (details) => {
    if (typeof details.seekTime === "number") seekTo(details.seekTime, details.fastSeek);
  });
  safeSetAction("seekbackward", (details) => seekTo(audio.currentTime - (details.seekOffset ?? 10)));
  safeSetAction("seekforward", (details) => seekTo(audio.currentTime + (details.seekOffset ?? 10)));

  const positionEvents: (keyof HTMLMediaElementEventMap)[] = ["durationchange", "ratechange", "timeupdate", "seeked"];
  positionEvents.forEach((eventName) => audio.addEventListener(eventName, updatePositionState));
  audio.addEventListener("playing", updatePlayingState);
  audio.addEventListener("pause", updatePausedState);
  audio.addEventListener("ended", updatePausedState);
  updatePositionState();

  return () => {
    positionEvents.forEach((eventName) => audio.removeEventListener(eventName, updatePositionState));
    audio.removeEventListener("playing", updatePlayingState);
    audio.removeEventListener("pause", updatePausedState);
    audio.removeEventListener("ended", updatePausedState);
    safeSetAction("play", null);
    safeSetAction("pause", null);
    safeSetAction("stop", null);
    safeSetAction("seekto", null);
    safeSetAction("seekbackward", null);
    safeSetAction("seekforward", null);
    try {
      mediaSession.setPositionState();
      mediaSession.playbackState = "none";
      mediaSession.metadata = null;
    } catch {
      // Cleanup is best-effort for older WebKit versions.
    }
  };
}

async function responseError(response: Response): Promise<Error> {
  const fallback = `Live audio request failed (HTTP ${response.status})`;
  try {
    const payload = (await response.json()) as { error?: { code?: string; message?: string } };
    const message = payload.error?.message ?? fallback;
    return new Error(payload.error?.code ? `${message} (${payload.error.code})` : message);
  } catch {
    return new Error(response.statusText || fallback);
  }
}

export default function StoryModal({ open, phraseIds, onClose }: StoryModalProps) {
  const { apiCall, apiFetch } = useApi();
  const [story, setStory] = useState<StoryContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [liveAudioState, setLiveAudioState] = useState<"idle" | "connecting" | "playing">("idle");
  const [retryPlaybackRequired, setRetryPlaybackRequired] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const liveAudioRef = useRef<HTMLAudioElement | null>(null);
  const liveAbortRef = useRef<AbortController | null>(null);
  const liveContextRef = useRef<AudioContext | null>(null);
  const livePlayerRef = useRef<PcmStreamPlayer | null>(null);
  const liveKeepAliveRef = useRef<HTMLAudioElement | null>(null);
  const liveAudioObjectUrlRef = useRef<string | null>(null);
  const liveMediaSessionCleanupRef = useRef<(() => void) | null>(null);
  const previousAudioSessionTypeRef = useRef<string | null>(null);
  const storyContentRef = useRef<HTMLDivElement | null>(null);
  const isOpenRef = useRef(open);

  const stopStoryAudio = useCallback(() => {
    const audio = audioRef.current;
    setRetryPlaybackRequired(false);
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audioRef.current = null;
  }, []);

  const stopLiveAudio = useCallback(() => {
    liveAbortRef.current?.abort();
    liveAbortRef.current = null;
    liveMediaSessionCleanupRef.current?.();
    liveMediaSessionCleanupRef.current = null;
    const audio = liveAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      liveAudioRef.current = null;
    }
    if (liveAudioObjectUrlRef.current) {
      URL.revokeObjectURL(liveAudioObjectUrlRef.current);
      liveAudioObjectUrlRef.current = null;
    }
    livePlayerRef.current?.stop();
    livePlayerRef.current = null;
    const keepAlive = liveKeepAliveRef.current;
    if (keepAlive) {
      keepAlive.pause();
      keepAlive.currentTime = 0;
      liveKeepAliveRef.current = null;
    }
    const audioSession = getAudioSession();
    if (audioSession && previousAudioSessionTypeRef.current) {
      try {
        audioSession.type = previousAudioSessionTypeRef.current;
      } catch {
        // Older WebKit versions expose a read-only or partial Audio Session API.
      }
    }
    previousAudioSessionTypeRef.current = null;
    const context = liveContextRef.current;
    liveContextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
    setLiveAudioState("idle");
  }, []);

  const stopAllAudio = useCallback(() => {
    stopStoryAudio();
    stopLiveAudio();
  }, [stopLiveAudio, stopStoryAudio]);

  const startNativePcmAudio = useCallback(
    async (pcm: Uint8Array, startAtSeconds: number | (() => number)) => {
      const audio = liveKeepAliveRef.current ?? new Audio();
      liveKeepAliveRef.current = null;
      audio.loop = false;
      audio.preload = "auto";
      audio.setAttribute("playsinline", "");

      if (liveAudioObjectUrlRef.current) URL.revokeObjectURL(liveAudioObjectUrlRef.current);
      const objectUrl = URL.createObjectURL(createPcmWavBlob(pcm));
      liveAudioObjectUrlRef.current = objectUrl;
      liveAudioRef.current = audio;

      const metadataReady = new Promise<void>((resolve, reject) => {
        audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
        audio.addEventListener("error", () => reject(new Error("iPhone could not prepare live audio controls.")), {
          once: true,
        });
      });
      audio.src = objectUrl;
      liveMediaSessionCleanupRef.current?.();
      liveMediaSessionCleanupRef.current = attachNativeMediaSession(audio, stopLiveAudio);
      audio.load();
      await metadataReady;
      const requestedPosition = typeof startAtSeconds === "function" ? startAtSeconds() : startAtSeconds;
      audio.currentTime = Math.min(Math.max(0, requestedPosition), Math.max(0, audio.duration - 0.05));
      audio.onended = stopLiveAudio;
      audio.onerror = () => {
        setError("The live story audio could not be played (NATIVE_AUDIO_FAILED).");
        stopLiveAudio();
      };
      await audio.play();
    },
    [stopLiveAudio]
  );

  const closeStory = useCallback(() => {
    stopAllAudio();
    onClose();
  }, [onClose, stopAllAudio]);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTranslation(null);
    setTranslationError(null);
    stopAllAudio();
    try {
      const result = await apiCall<StoryContent>("/api/stories/generate", {
        method: "POST",
        body: JSON.stringify({ phrase_ids: phraseIds }),
      });
      setStory(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a story.");
    } finally {
      setLoading(false);
    }
  }, [apiCall, phraseIds, stopAllAudio]);

  const copyStory = useCallback(async () => {
    if (!story) return;
    try {
      await navigator.clipboard.writeText(storyContentRef.current?.innerText ?? story.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not copy the story.");
    }
  }, [story]);

  const playStory = useCallback(async () => {
    if (!story) return;
    setAudioLoading(true);
    setError(null);
    stopAllAudio();
    try {
      const result = await apiCall<{ url: string }>("/api/stories/audio", {
        method: "POST",
        body: JSON.stringify({ content: story.content }),
      });
      const nextAudio = new Audio(result.url);
      if (!isOpenRef.current) return;
      nextAudio.preload = "auto";
      audioRef.current = nextAudio;
      try {
        await nextAudio.play();
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          setRetryPlaybackRequired(true);
          setError("Audio is ready. Tap the speaker again to play it.");
          return;
        }
        stopStoryAudio();
        throw err;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not play story audio.");
    } finally {
      setAudioLoading(false);
    }
  }, [apiCall, stopAllAudio, stopStoryAudio, story]);

  const playPreparedStory = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setError(null);
    setRetryPlaybackRequired(false);
    // Call play synchronously in the click handler. Browser autoplay policies,
    // especially on iOS, can reject playback after an awaited API request.
    void audio.play().catch((err: unknown) => {
      setRetryPlaybackRequired(true);
      setError(err instanceof Error ? err.message : "Could not play story audio.");
    });
  }, []);

  const playLiveStory = useCallback(async () => {
    if (!story) return;
    if (liveAudioState !== "idle") {
      stopLiveAudio();
      return;
    }

    stopAllAudio();
    setError(null);
    setLiveAudioState("connecting");

    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor || typeof ReadableStream === "undefined") {
      setError("Live audio is not supported by this browser (WEB_AUDIO_UNAVAILABLE).");
      setLiveAudioState("idle");
      return;
    }

    const abortController = new AbortController();
    const audioContext = new AudioContextConstructor();
    liveAbortRef.current = abortController;
    liveContextRef.current = audioContext;
    const audioResumePromise = audioContext.resume();

    // iOS WebKit requires audio to be started directly inside the tap handler.
    // A silent buffer unlocks Web Audio; a looping silent media element keeps the
    // native playback session alive while the screen is locked or Chrome is backgrounded.
    const unlockSource = audioContext.createBufferSource();
    unlockSource.buffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
    unlockSource.connect(audioContext.destination);
    unlockSource.start();

    if (isIosDevice()) {
      const audioSession = getAudioSession();
      if (audioSession) {
        previousAudioSessionTypeRef.current = audioSession.type;
        try {
          audioSession.type = "playback";
        } catch {
          // The silent media element below is the fallback for older iOS versions.
        }
      }
      const keepAlive = new Audio(liveAudioKeepAliveUrl);
      keepAlive.loop = true;
      keepAlive.preload = "auto";
      keepAlive.setAttribute("playsinline", "");
      liveKeepAliveRef.current = keepAlive;
      void keepAlive.play().catch(() => undefined);
    }
    let keepCachedAudio = false;

    try {
      await audioResumePromise;
      if (audioContext.state !== "running") {
        throw new Error("iOS did not start the live audio session. Tap Live audio again (AUDIO_CONTEXT_SUSPENDED).");
      }
      const browserCachedAudio = storyLiveAudioCache.get(story.content);
      if (browserCachedAudio) {
        if (isIosDevice()) {
          await startNativePcmAudio(browserCachedAudio, 0);
          await audioContext.close();
          liveContextRef.current = null;
          keepCachedAudio = true;
          setLiveAudioState("playing");
          return;
        }
        const player = new PcmStreamPlayer(audioContext);
        livePlayerRef.current = player;
        setLiveAudioState("playing");
        player.push(browserCachedAudio);
        await player.finish();
        return;
      }

      const response = await apiFetch("/api/stories/audio/stream", {
        method: "POST",
        body: JSON.stringify({ content: story.content }),
        headers: { Accept: `${LIVE_AUDIO_CONTENT_TYPE}, application/json` },
        signal: abortController.signal,
      });
      if (!response.ok) throw await responseError(response);
      if (!isOpenRef.current || abortController.signal.aborted) return;

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const payload = (await response.json()) as { mode?: string; url?: string };
        if (payload.mode !== "cached" || !payload.url)
          throw new Error("Live audio cache returned an invalid response.");

        await audioContext.close();
        liveContextRef.current = null;
        const audio = liveKeepAliveRef.current ?? new Audio();
        liveKeepAliveRef.current = null;
        audio.loop = false;
        audio.src = payload.url;
        liveAudioRef.current = audio;
        liveMediaSessionCleanupRef.current?.();
        liveMediaSessionCleanupRef.current = attachNativeMediaSession(audio, stopLiveAudio);
        audio.onended = stopLiveAudio;
        audio.onerror = () => {
          setError("The cached story audio could not be played (CACHED_AUDIO_FAILED).");
          stopLiveAudio();
        };
        await audio.play();
        if (abortController.signal.aborted) return;
        keepCachedAudio = true;
        setLiveAudioState("playing");
        return;
      }

      if (!contentType.includes(LIVE_AUDIO_CONTENT_TYPE) || !response.body) {
        throw new Error("Live audio returned an unsupported response (INVALID_STREAM_RESPONSE).");
      }

      await audioContext.resume();
      const player = new PcmStreamPlayer(audioContext);
      const decoder = new LiveAudioFrameDecoder();
      const reader = response.body.getReader();
      livePlayerRef.current = player;
      let receivedAudio = false;
      let receivedEnd = false;
      const receivedChunks: Uint8Array[] = [];

      while (!receivedEnd) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of decoder.push(value)) {
          if (frame.type === LIVE_AUDIO_FRAME.audio) {
            player.push(frame.payload);
            receivedChunks.push(frame.payload);
            if (!receivedAudio) {
              receivedAudio = true;
              setLiveAudioState("playing");
            }
          } else if (frame.type === LIVE_AUDIO_FRAME.error) {
            const detail = JSON.parse(new TextDecoder().decode(frame.payload)) as { code?: string; message?: string };
            throw new Error(`${detail.message ?? "Google TTS streaming failed."} (${detail.code ?? "STREAM_FAILED"})`);
          } else if (frame.type === LIVE_AUDIO_FRAME.end) {
            receivedEnd = true;
          }
        }
      }

      decoder.finish();
      if (!receivedAudio) throw new Error("Google TTS returned no live audio (EMPTY_STREAM).");
      if (!receivedEnd) throw new Error("The live audio connection ended unexpectedly (INCOMPLETE_STREAM).");
      storyLiveAudioCache.set(story.content, receivedChunks);
      const completedPcm = storyLiveAudioCache.get(story.content);
      if (isIosDevice() && completedPcm) {
        const position = player.getPositionSeconds();
        if (position + 0.1 < getPcmDurationSeconds(completedPcm)) {
          await startNativePcmAudio(completedPcm, () => player.getPositionSeconds());
          player.stop();
          livePlayerRef.current = null;
          await audioContext.close();
          liveContextRef.current = null;
          keepCachedAudio = true;
          return;
        }
      }
      await player.finish();
    } catch (err) {
      if (!abortController.signal.aborted) {
        setError(err instanceof Error ? err.message : "Could not play live story audio (STREAM_FAILED).");
      }
    } finally {
      if (!keepCachedAudio && liveAbortRef.current === abortController) stopLiveAudio();
    }
  }, [apiFetch, liveAudioState, startNativePcmAudio, stopAllAudio, stopLiveAudio, story]);

  const translateStory = useCallback(async () => {
    if (!story) return;
    setTranslationLoading(true);
    setTranslationError(null);
    try {
      const result = await apiCall<TranslationResult>("/api/stories/translate", {
        method: "POST",
        body: JSON.stringify({ content: story.content, phrase_ids: phraseIds }),
      });
      setTranslation(result.translation);
    } catch (err) {
      setTranslationError(err instanceof Error ? err.message : "Could not translate the story.");
    } finally {
      setTranslationLoading(false);
    }
  }, [apiCall, phraseIds, story]);

  useEffect(() => {
    isOpenRef.current = open;
    if (!open) {
      stopAllAudio();
      return;
    }
    setStory(null);
    setError(null);
    setTranslation(null);
    setTranslationError(null);
    stopAllAudio();
    void generate();
  }, [generate, open, stopAllAudio]);

  useEffect(() => () => stopAllAudio(), [stopAllAudio]);

  useEffect(() => {
    const resumeLiveAudio = () => {
      const context = liveContextRef.current;
      if (document.visibilityState === "visible" && context?.state === "suspended") {
        void context.resume().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", resumeLiveAudio);
    window.addEventListener("pageshow", resumeLiveAudio);
    return () => {
      document.removeEventListener("visibilitychange", resumeLiveAudio);
      window.removeEventListener("pageshow", resumeLiveAudio);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => event.key === "Escape" && !loading && closeStory();
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeStory, loading, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 px-0 backdrop-blur-sm sm:items-center sm:px-4 sm:py-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="AI exercise"
        className="flex h-[100dvh] w-full flex-col overflow-hidden bg-card shadow-lg sm:h-auto sm:max-h-[80vh] sm:max-w-2xl sm:rounded-lg sm:border sm:border-border"
      >
        <header className="hidden items-start justify-between gap-4 border-b border-border px-4 py-3 sm:flex">
          <div>
            <h2 id="story-title" className="text-base font-semibold">
              Your AI exercise
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Generated from {phraseIds.length} selected expressions.
            </p>
          </div>
          <button
            type="button"
            onClick={closeStory}
            disabled={loading}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading && (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Creating a memorable story...
            </div>
          )}
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          {translationError && (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{translationError}</p>
              <Button size="sm" variant="outline" onClick={() => void translateStory()}>
                Retry
              </Button>
            </div>
          )}
          {!loading && story && (
            <div
              ref={storyContentRef}
              className="markdown-content select-text text-base leading-7 text-foreground [-webkit-user-select:text] sm:text-sm"
              dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(translation ?? story.content) }}
            />
          )}
        </main>
        <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button onClick={closeStory} disabled={loading}>
            Close
          </Button>
          <Button
            onClick={() => void translateStory()}
            disabled={loading || translationLoading || !story}
            size="icon"
            aria-label="Translate the whole story into Polish"
            title="Translate the whole story into Polish"
          >
            {translationLoading ? <LoaderCircle className="size-4 animate-spin" /> : <Languages className="size-4" />}
          </Button>
          <Button
            onClick={() => (retryPlaybackRequired ? playPreparedStory() : void playStory())}
            disabled={loading || audioLoading || liveAudioState === "connecting" || !story}
            size="icon"
            aria-label="Play English story"
            title={retryPlaybackRequired ? "Tap again to play the prepared story audio" : "Play English story"}
          >
            {audioLoading ? <LoaderCircle className="size-4 animate-spin" /> : <Volume2 className="size-4" />}
          </Button>
          <Button
            onClick={() => void playLiveStory()}
            disabled={loading || audioLoading || !story}
            aria-label={liveAudioState === "idle" ? "Play live English story audio (beta)" : "Stop live audio"}
            title={liveAudioState === "idle" ? "Live audio (beta)" : "Stop live audio"}
            className="gap-1.5 px-2"
          >
            {liveAudioState === "connecting" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : liveAudioState === "playing" ? (
              <Square className="size-3.5" />
            ) : (
              <Waves className="size-4" />
            )}
            <span className="text-xs sm:hidden">{liveAudioState === "idle" ? "Live β" : "Stop"}</span>
            <span className="hidden text-xs sm:inline">
              {liveAudioState === "idle" ? "Live audio (beta)" : "Stop live"}
            </span>
          </Button>
          <Button
            onClick={() => void copyStory()}
            disabled={loading || !story}
            size="icon"
            aria-label="Copy story to clipboard"
            title="Copy story to clipboard"
          >
            <Copy className="size-4" />
          </Button>
          <Button
            onClick={() => void generate()}
            disabled={loading}
            size="icon"
            aria-label="Generate another story"
            title="Generate another story"
          >
            <RefreshCw className="size-4" />
          </Button>
        </footer>
      </section>
    </div>
  );
}
